import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { formatSkillsForPrompt } from '../hero-skills.js';
import { execGit } from '../git-exec.js';
import { applyPatches } from '../patch.js';
import { syncWorkingTreeFilesIntoWorktree } from '../sync-from-main.js';
import type { WorktreeSession } from '../worktree.js';
import { ConfigurationManager } from './config-manager.js';
import { parseArgv, type ParsedArgv } from './argv.js';
import { AIHeroSkillRegistry } from './ai-hero-skill-registry.js';
import { SkillRouter } from './skill-router.js';
import { AIProviderManager } from './ai-provider-manager.js';
import { ImplementationPlanner } from './implementation-planner.js';
import { AgentExecutor, fallbackConsoleLogPatch } from './agent-executor.js';
import { CodeReviewOrchestrator } from './code-review-orchestrator.js';
import { AutoFixEngine } from './auto-fix-engine.js';
import { GitWorktreeManager, BranchManager } from './git-managers.js';
import { QualityGateOrchestrator, TestRunner } from './quality-runner.js';
import { MergeManager } from './merge-manager.js';
import { PullRequestManager } from './pull-request-manager.js';
import { DockerManager } from './docker-manager.js';
import { DeploymentManager } from './deployment-manager.js';
import { RollbackManager } from './rollback-manager.js';
import { WorkflowStateManager } from './workflow-state-manager.js';
import { CommitMessageGenerator } from './commit-message-generator.js';
import { ReportGenerator } from './report-generator.js';
import type { ExecutionReport, GateResult, SkillInvocation, WorkflowState } from './types.js';
import { parseGitHubRepoFromUrl, resolveRemoteUrl } from '../gh-pr.js';
import type { ReviewResult } from '../review-json.js';

const mainRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const logLines: string[] = [];
function step(name: string, detail: string) {
  const line = `[${new Date().toISOString()}] ${name}: ${detail}`;
  logLines.push(line);
  console.log(line);
}

function runInWorktree(session: WorktreeSession, command: string, args: string[]): string {
  return execFileSync(command, args, {
    cwd: session.path,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
}

async function gitCommitAll(session: WorktreeSession, title: string, body: string): Promise<boolean> {
  execGit(session.path, ['add', '-A']);
  const st = execGit(session.path, ['status', '--short']).trim();
  if (!st) {
    step('git commit', 'No changes to commit.');
    return false;
  }
  execGit(session.path, ['commit', '-m', `${title}\n\n${body}`, '--no-gpg-sign']);
  return true;
}

function gitPush(session: WorktreeSession): void {
  execGit(session.path, ['push', '-u', 'origin', session.branch]);
}

function blockingReviewFindings(r: ReviewResult): boolean {
  return r.findings.some(f => f.severity === 'critical' || f.severity === 'high');
}

export async function runSdlcFromArgv(argv: string[]): Promise<void> {
  const cfg = new ConfigurationManager().get();
  const parsed = parseArgv(argv);
  const stateMgr = new WorkflowStateManager(mainRepoRoot);

  if (parsed.mode === 'dryRun') {
    console.log(JSON.stringify(cfg, null, 2));
    return;
  }
  if (parsed.mode === 'status') {
    const s = await stateMgr.load(cfg.workflow.stateFile);
    console.log(s ? JSON.stringify(s, null, 2) : 'No workflow state file yet.');
    return;
  }
  if (parsed.mode === 'resume') {
    const s = await stateMgr.load(cfg.workflow.stateFile);
    if (!s) {
      console.error('Nothing to resume.');
      process.exitCode = 1;
      return;
    }
    console.error(
      'Resume is not fully implemented; re-run with the same instruction or inspect .sdlc/workflow-state.json',
    );
    console.log(JSON.stringify(s, null, 2));
    process.exitCode = 1;
    return;
  }

  if (parsed.mode === 'reviewOnly') {
    console.error('Use the full pipeline; --review-only is reserved for a future release.');
    process.exitCode = 1;
    return;
  }

  if (parsed.mode === 'deployOnly') {
    const dm = new DockerManager(cfg.docker);
    const dep = new DeploymentManager(cfg, dm);
    const short = execGit(mainRepoRoot, ['rev-parse', '--short', 'HEAD']).trim();
    const r = dep.deployLocal(mainRepoRoot, short);
    step('deploy-only', r.output.slice(-3000));
    const health = dm.healthChecks();
    console.log(JSON.stringify({ health }, null, 2));
    return;
  }

  await runFullPipeline(parsed, cfg, stateMgr);
}

async function runFullPipeline(
  parsed: ParsedArgv,
  cfg: ReturnType<ConfigurationManager['get']>,
  stateMgr: WorkflowStateManager,
): Promise<void> {
  const instruction = parsed.instruction;
  const gitWt = new GitWorktreeManager(cfg);
  const branchMgr = new BranchManager(cfg);
  const aiPm = new AIProviderManager(cfg.ai);
  const client = aiPm.createClient();
  const model = aiPm.model();
  const mergeMgr = new MergeManager(cfg);
  const prMgr = new PullRequestManager(cfg);
  const dockerMgr = new DockerManager(cfg.docker);
  const deployMgr = new DeploymentManager(cfg, dockerMgr);
  const rollbackMgr = new RollbackManager(cfg.docker);
  const gateOrch = new QualityGateOrchestrator(cfg.qualityGates);
  const testRunner = new TestRunner();
  const commitGen = new CommitMessageGenerator();
  const reportGen = new ReportGenerator();

  const state: WorkflowState = {
    version: 1,
    startedAt: new Date().toISOString(),
    instruction,
    phase: 'plan',
  };
  await stateMgr.save(cfg.workflow.stateFile, state);

  step('instruction', instruction);
  const origBranch = execGit(mainRepoRoot, ['branch', '--show-current'], true).trim() || '(detached)';
  step('git isolation', `Main checkout preserved; worktrees under ${path.join(mainRepoRoot, cfg.git.worktreesDirectory)}.`);

  const baseSha = gitWt.resolveBaseSha(mainRepoRoot);
  step('git base', `Using base ${baseSha} (config baseBranch=${branchMgr.baseBranch})`);
  state.baseSha = baseSha;

  const session = await gitWt.create(mainRepoRoot, baseSha);
  state.featureBranch = session.branch;
  await stateMgr.save(cfg.workflow.stateFile, state);

  const gateResults: GateResult[] = [];
  const skillInvocations: SkillInvocation[] = [];
  let implementationSummary = '';
  let reviewText = '';
  let prUrl: string | null = null;
  let prNumber: number | null = null;
  let mergeStatus = 'not attempted';
  let deployStatus = 'not attempted';
  let dockerTag = '';
  const healthResults: { name: string; ok: boolean; detail: string }[] = [];
  let rollbackStatus: string | undefined;
  let lastReview: ReviewResult = { findings: [], needsMoreChanges: false };

  try {
    step('worktree', `${session.path} branch ${session.branch}`);

    const synced = await syncWorkingTreeFilesIntoWorktree(mainRepoRoot, session.path, [...cfg.syncPathsFromMain]);
    if (synced.length) step('sync from main checkout', synced.join(', '));

    runInWorktree(session, 'npm', ['install']);

    const registry = new AIHeroSkillRegistry(session.path, cfg.aiHero);
    const discovered = await registry.discover();
    const installInv = await registry.ensureOfficialCatalogIfRequested();
    if (installInv) skillInvocations.push(installInv);

    const router = new SkillRouter(cfg.aiHero);
    const selected = router.selectForInstruction(instruction, discovered);
    const selectedIds = selected.map(s => s.id);
    for (const v of registry.validate(selectedIds)) {
      skillInvocations.push({
        ...v,
        ran: v.evidence.includes('SKILL.md present'),
        mechanism: v.ran
          ? 'SKILL.md loaded and injected into OpenAI plan/review prompts (Node orchestrator; not Cursor tool runtime)'
          : v.mechanism,
      });
    }

    const skillsBlock = formatSkillsForPrompt(selected);
    await mkdir(path.join(session.path, 'artifacts'), { recursive: true });

    const planner = new ImplementationPlanner(client, model);
    const planMd = await planner.plan(instruction, selected, path.join(session.path, 'package.json'));
    await writeFile(path.join(session.path, 'artifacts', 'plan.md'), `# Plan\n\n${planMd}\n`);
    state.phase = 'implement';
    await stateMgr.save(cfg.workflow.stateFile, state);

    let implAttempt = 0;
    while (implAttempt < cfg.workflow.maxImplementationRetries) {
      implAttempt++;
      if (client) {
        const agent = new AgentExecutor(client, model);
        const r = await agent.implement(instruction, {
          paths: ['apps/web/src/main.tsx', 'apps/api/src/index.ts'],
          repoRoot: session.path,
        });
        await agent.apply(session.path, r.patches);
        implementationSummary = r.summary;
      } else {
        const fb = await fallbackConsoleLogPatch(session.path, instruction);
        if (fb.length) {
          await applyPatches(session.path, fb);
          implementationSummary =
            'Fallback: minimal change (set OPENAI_API_KEY for full OpenAI implementation).';
        } else {
          implementationSummary = 'No OPENAI_API_KEY: skipped automated code edits.';
        }
      }
      const buildTry = testRunner.runInWorktree(session.path, 'npm', ['run', 'build'], cfg.qualityGates.build.timeoutMs);
      if (buildTry.ok) break;
      if (implAttempt >= cfg.workflow.maxImplementationRetries) {
        throw new Error(`Implementation failed build after ${implAttempt} attempts: ${buildTry.output.slice(-2000)}`);
      }
    }

    state.phase = 'validate';

    gateResults.push(
      await gateOrch.runGate('build', session.path, async p =>
        Promise.resolve(testRunner.runInWorktree(session.path, 'npm', ['run', 'build'], p.timeoutMs)),
      ),
    );

    gateResults.push(
      await gateOrch.runGate('dependencyAudit', session.path, async p =>
        Promise.resolve(testRunner.runInWorktree(session.path, 'npm', ['run', 'security'], p.timeoutMs)),
      ),
    );

    if (cfg.qualityGates.e2e.enabled && process.env.SDLC_SKIP_PLAYWRIGHT !== '1') {
      runInWorktree(session, 'npx', ['playwright', 'install', 'chromium']);
    }
    gateResults.push(
      await gateOrch.runGate('e2e', session.path, async () => {
        if (!cfg.qualityGates.e2e.enabled) {
          return { ok: false, output: 'e2e disabled in sdlc.config.ts (not executed).' };
        }
        if (process.env.SDLC_SKIP_PLAYWRIGHT === '1') {
          return { ok: false, output: 'Skipped via SDLC_SKIP_PLAYWRIGHT=1 (not counted as passed).' };
        }
        return testRunner.runInWorktree(session.path, 'npx', ['playwright', 'test'], cfg.qualityGates.e2e.timeoutMs);
      }),
    );

    gateResults.push(
      await gateOrch.runGate('dast', session.path, async () => {
        if (!cfg.qualityGates.dast.enabled) {
          return { ok: false, output: 'DAST disabled in sdlc.config.ts (not executed).' };
        }
        try {
          execFileSync('curl', ['-sf', 'http://127.0.0.1:4000/health'], { timeout: 5000 });
          execFileSync('curl', ['-sf', 'http://127.0.0.1:4000/api/todos'], { timeout: 5000 });
          return { ok: true, output: 'GET /health and /api/todos OK (local smoke).' };
        } catch (e) {
          return {
            ok: false,
            output: `DAST smoke failed (start dev servers or disable dast): ${String((e as Error).message)}`,
          };
        }
      }),
    );

    gateResults.push(
      await gateOrch.runGate('dockerBuild', mainRepoRoot, async () => {
        if (!cfg.qualityGates.dockerBuild.enabled) {
          return { ok: false, output: 'docker build gate disabled (not executed).' };
        }
        const short = execGit(session.path, ['rev-parse', '--short', 'HEAD']).trim();
        dockerTag = cfg.docker.imageTagTemplate.replace('{{shortSha}}', short);
        return dockerMgr.build(mainRepoRoot, dockerTag);
      }),
    );

    const gateSummary = gateResults
      .map(g => `- **${g.id}**: ${g.status}${g.mandatory ? ' (mandatory)' : ' (optional)'} — ${g.output.slice(0, 120)}…`)
      .join('\n');

    const title = commitGen.generateTitle('sdlc', implementationSummary || instruction);
    const bodyParts: Parameters<typeof commitGen.generateBody>[0] = {
      why: `Autonomous SDLC for: ${instruction}`,
      what: implementationSummary,
      components: ['apps/web', 'apps/api', 'orchestrator'],
      architecture: 'Implementation in isolated git worktree linked from main; main checkout untouched.',
      security: 'npm audit --audit-level=high; optional DAST HTTP smoke when enabled.',
      tests: gateSummary.slice(0, 4000),
      breaking: 'None intended.',
    };
    const commitBody = commitGen.generateBody(bodyParts);

    await gitCommitAll(session, title, commitBody);
    if (cfg.git.autoPush) gitPush(session);

    const commitSha = execGit(session.path, ['rev-parse', 'HEAD']).trim();
    const { stat: diffStat, files: changedFiles } = commitGen.describeDiff(session.path);
    state.commitSha = commitSha;
    state.phase = 'pr';
    await stateMgr.save(cfg.workflow.stateFile, state);

    const prBodyDraft = [
      `## Business requirement`,
      instruction,
      ``,
      `## Implementation summary`,
      implementationSummary,
      ``,
      `## Quality gates`,
      gateSummary,
      `\n_Note: **skipped** or **failed** gates are not reported as passed. Mandatory gates must show **passed** to auto-merge (subject to GitHub branch protection)._\n`,
      ``,
      `## Files changed`,
      changedFiles.map(f => `- \`${f}\``).join('\n') || diffStat,
    ].join('\n');

    if (cfg.git.autoCreatePr) {
      const pr = await prMgr.createOrUpdate(session, instruction, prBodyDraft);
      prUrl = pr.prUrl;
      prNumber = pr.prNumber;
      state.prUrl = prUrl;
      state.prNumber = prNumber;
      step('github', pr.message);
    }

    state.phase = 'review';
    await stateMgr.save(cfg.workflow.stateFile, state);

    const reviewPaths = ['apps/web/src/main.tsx', 'apps/api/src/index.ts'];

    if (client && cfg.aiHero.executionEnabled) {
      const reviewer = new CodeReviewOrchestrator(client, model);
      const fixer = new AutoFixEngine(reviewer);
      let iter = 0;
      lastReview = await reviewer.runIteration(instruction, skillsBlock, session, reviewPaths);
      reviewText = lastReview.findings.map(f => `[${f.severity}] ${f.file}: ${f.issue}`).join('\n');

      while (iter < cfg.workflow.maxAiReviewIterations) {
        const applied = await fixer.applyPatchesIfAny(session, lastReview);
        if (applied) {
          const b = testRunner.runInWorktree(session.path, 'npm', ['run', 'build'], cfg.qualityGates.build.timeoutMs);
          if (!b.ok) throw new Error(`Review fix broke build: ${b.output.slice(-1500)}`);
          await gitCommitAll(
            session,
            `fix(sdlc): address review iteration ${iter + 1}`,
            `Automated fixes from AI Hero review.\n\nFindings addressed:\n${reviewText.slice(0, 2000)}`,
          );
          if (cfg.git.autoPush) gitPush(session);
        }
        iter++;
        if (!lastReview.needsMoreChanges && !blockingReviewFindings(lastReview)) break;
        if (iter >= cfg.workflow.maxAiReviewIterations) break;
        lastReview = await reviewer.runIteration(instruction, skillsBlock, session, reviewPaths);
        reviewText = lastReview.findings.map(f => `[${f.severity}] ${f.file}: ${f.issue}`).join('\n');
        if (!lastReview.needsMoreChanges && !blockingReviewFindings(lastReview)) break;
      }

      const fullPr =
        prBodyDraft +
        `\n\n## AI Hero code review\n\n${reviewText || 'No findings.'}\n\n## Log (tail)\n\n${logLines.slice(-30).join('\n')}`;
      await prMgr.updateBody(session, fullPr);
    } else {
      reviewText = client ? '' : 'AI review skipped (OPENAI_API_KEY not set). Skills were still loaded for routing metadata.';
      await prMgr.updateBody(
        session,
        prBodyDraft + `\n\n## AI Hero code review\n\n${reviewText}\n`,
      );
    }

    state.phase = 'merge';
    await stateMgr.save(cfg.workflow.stateFile, state);

    const blockMergeReview = client ? blockingReviewFindings(lastReview) : false;
    const mergeCheck = mergeMgr.canAutoMerge(gateResults, blockMergeReview);

    const remote = resolveRemoteUrl(session);
    const repoIds = remote ? parseGitHubRepoFromUrl(remote) : null;
    const owner = process.env.GITHUB_OWNER ?? repoIds?.owner;
    const repo = process.env.GITHUB_REPO ?? repoIds?.repo;

    const canMerge =
      cfg.git.autoMerge &&
      mergeCheck.ok &&
      cfg.git.autoPush &&
      prNumber !== null &&
      owner &&
      repo;

    if (canMerge) {
      const mr = mergeMgr.mergePr(session, owner, repo, prNumber!);
      mergeStatus = mr.ok ? 'merged (requested via gh; may be queued pending CI / branch protection)' : mr.message;
      state.mergeAttempted = true;
      state.mergeSucceeded = mr.ok;
    } else {
      mergeStatus = mergeCheck.ok
        ? 'Merge skipped (autoMerge off, missing pr number, or gh repo resolution).'
        : mergeCheck.reason;
    }

    state.phase = 'deploy';
    await stateMgr.save(cfg.workflow.stateFile, state);

    if (cfg.docker.enabled && state.mergeSucceeded && process.env.SDLC_DEPLOY_LOCAL === '1') {
      const short = execGit(mainRepoRoot, ['rev-parse', '--short', 'HEAD']).trim();
      const dep = deployMgr.deployLocal(mainRepoRoot, short);
      deployStatus = dep.ok ? 'docker compose up -d --build' : dep.output.slice(-2000);
      healthResults.push(...dockerMgr.healthChecks());
      state.deployAttempted = true;
      if (healthResults.some(x => !x.ok) && cfg.docker.rollbackOnFailedHealth) {
        rollbackStatus = rollbackMgr.down(mainRepoRoot);
      }
    } else {
      deployStatus =
        cfg.docker.enabled && state.mergeSucceeded
          ? 'Skipped: set SDLC_DEPLOY_LOCAL=1 to run local compose after merge.'
          : 'Skipped (merge not succeeded or Docker disabled).';
    }

    state.phase = 'done';
    await stateMgr.save(cfg.workflow.stateFile, state);

    const report: ExecutionReport = {
      originalBranch: origBranch,
      featureBranch: session.branch,
      baseSha,
      selectedSkills: selectedIds,
      skillInvocations,
      implementationSummary,
      filesChanged: changedFiles,
      commitSha,
      commitMessage: `${title}\n\n${commitBody}`,
      prUrl,
      reviewFindings: reviewText,
      gateResults,
      mergeStatus,
      dockerImageTag: dockerTag,
      deploymentStatus: deployStatus,
      healthResults,
      rollbackStatus,
    };
    const reportPath = await reportGen.writeMarkdown(mainRepoRoot, cfg.workflow.reportDir, report);
    step('report', reportPath);

    console.log(
      `\nFinished.\n  Report: ${reportPath} (inside worktree until cleanup)\n  PR: ${prUrl ?? 'n/a'}\n  Merge: ${mergeStatus}\n  Main checkout: untouched.\n`,
    );
  } finally {
    await gitWt.remove(session);
  }
}
