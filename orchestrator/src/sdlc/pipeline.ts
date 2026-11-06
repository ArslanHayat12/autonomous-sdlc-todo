import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { formatSkillsForPrompt, type HeroSkill } from '../hero-skills.js';
import { execGit } from '../git-exec.js';
import { applyPatches } from '../patch.js';
import { syncWorkingTreeFilesIntoWorktree, syncUncommittedFromMain } from '../sync-from-main.js';
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
import { pruneStaleSdlcWorktrees } from './worktree-prune.js';
import type { ExecutionReport, GateResult, SkillInvocation, WorkflowState } from './types.js';
import { parseGitHubRepoFromUrl, resolveRemoteUrl } from '../gh-pr.js';
import type { ReviewResult } from '../review-json.js';
import type { SdlcConfigWithFeatures } from './feature-flags.js';

/** Monorepo root (pipeline lives in orchestrator/src/sdlc/) */
const mainRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

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
  const configMgr = new ConfigurationManager();
  const cfg = await configMgr.get(mainRepoRoot);
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
  cfg: SdlcConfigWithFeatures,
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
  step(
    'git isolation',
    cfg.git.worktreesEnabled
      ? `Main checkout preserved; linked worktrees under ${path.join(mainRepoRoot, cfg.git.worktreesDirectory)}.`
      : `In-place branch mode (sdlc.features.json isolatedWorktree: false); will restore ${origBranch} after run.`,
  );

  await pruneStaleSdlcWorktrees(mainRepoRoot, cfg);
  step('worktree prune', 'Stale sdlc worktrees removed when enabled in sdlc.config.ts (frees disk).');

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

    if (session.path !== mainRepoRoot) {
      const synced = await syncWorkingTreeFilesIntoWorktree(mainRepoRoot, session.path, [...cfg.syncPathsFromMain]);
      if (synced.length) step('sync from main checkout', synced.join(', '));
      if (cfg.features.syncUncommittedFromMain) {
        const u = await syncUncommittedFromMain(mainRepoRoot, session.path);
        const parts: string[] = [];
        if (u.copied.length) parts.push(`copied ${u.copied.length} (${u.copied.slice(0, 8).join(', ')}${u.copied.length > 8 ? '…' : ''})`);
        if (u.deleted.length) parts.push(`removed ${u.deleted.length} in worktree`);
        if (u.skipped.length) parts.push(`skipped ${u.skipped.length}`);
        step('sync uncommitted from main', parts.length ? parts.join('; ') : 'none');
      }
    } else {
      step('sync from main checkout', 'Skipped (session path is main repo — already the same tree).');
    }

    runInWorktree(session, 'npm', ['install']);

    let selectedIds: string[] = [];
    let discovered: HeroSkill[] = [];
    if (cfg.features.aiHeroSkills) {
      const registry = new AIHeroSkillRegistry(session.path, cfg.aiHero);
      discovered = await registry.discover();
      const installInv = await registry.ensureOfficialCatalogIfRequested();
      if (installInv) skillInvocations.push(installInv);

      const router = new SkillRouter(cfg.aiHero);
      const selected = router.selectForInstruction(instruction, discovered);
      selectedIds = selected.map(s => s.id);
      for (const v of registry.validate(selectedIds)) {
        skillInvocations.push({
          ...v,
          ran: v.evidence.includes('SKILL.md present'),
          mechanism: v.ran
            ? 'SKILL.md loaded and injected into OpenAI plan/review prompts (Node orchestrator; not Cursor tool runtime)'
            : v.mechanism,
        });
      }
    } else {
      step('ai hero skills', 'Off (sdlc.features.json aiHeroSkills: false).');
    }
    const selected = discovered.filter(s => selectedIds.includes(s.id));

    const skillsBlock = formatSkillsForPrompt(selected);
    await mkdir(path.join(session.path, 'artifacts'), { recursive: true });

    const planner = new ImplementationPlanner(client, model);
    const planMd = await planner.plan(instruction, selected, path.join(session.path, 'package.json'));
    await writeFile(path.join(session.path, 'artifacts', 'plan.md'), `# Plan\n\n${planMd}\n`);
    state.phase = 'implement';
    await stateMgr.save(cfg.workflow.stateFile, state);

    if (!cfg.features.autoImplement) {
      implementationSummary = 'Auto-implement disabled (sdlc.features.json autoImplement: false); no code edits applied.';
      step('implement', implementationSummary);
    } else {
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
    const archNote = cfg.git.worktreesEnabled
      ? 'Implementation in isolated git worktree linked from main; main checkout untouched.'
      : 'Implementation on a new branch in the main clone (isolatedWorktree: false); branch restored after run.';
    const bodyParts: Parameters<typeof commitGen.generateBody>[0] = {
      why: `Autonomous SDLC for: ${instruction}`,
      what: implementationSummary,
      components: ['apps/web', 'apps/api', 'orchestrator'],
      architecture: archNote,
      security: 'npm audit --audit-level=high; optional DAST HTTP smoke when enabled.',
      tests: gateSummary.slice(0, 4000),
      breaking: 'None intended.',
    };
    const commitBody = commitGen.generateBody(bodyParts);

    let committed = false;
    if (!cfg.git.autoCommit) {
      step('git commit', 'Skipped (sdlc.features.json autoCommit: false). Changes may be uncommitted in the session directory.');
    } else {
      committed = await gitCommitAll(session, title, commitBody);
      if (!committed) step('git commit', 'No changes to commit after gates.');
    }
    if (cfg.git.autoPush) {
      if (!cfg.git.autoCommit) {
        step('git push', 'Skipped (autoCommit is false in sdlc.features.json — commit locally before pushing).');
      } else if (!committed) {
        step('git push', 'Skipped (no new commit).');
      } else {
        try {
          gitPush(session);
        } catch (e) {
          step('git push', `Failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } else {
      step('git push', 'Skipped (sdlc.features.json autoPush: false).');
    }

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
      if (!cfg.git.autoPush || !cfg.git.autoCommit) {
        step(
          'github',
          'PR creation skipped: autoPr needs both autoCommit and autoPush (see sdlc.features.json).',
        );
      } else if (!committed) {
        step('github', 'PR creation skipped: no commit was pushed.');
      } else {
        const pr = await prMgr.createOrUpdate(session, instruction, prBodyDraft);
        prUrl = pr.prUrl;
        prNumber = pr.prNumber;
        state.prUrl = prUrl;
        state.prNumber = prNumber;
        step('github', pr.message);
      }
    } else {
      step('github', 'PR creation skipped (sdlc.features.json autoPr: false).');
    }

    state.phase = 'review';
    await stateMgr.save(cfg.workflow.stateFile, state);

    const reviewPaths = ['apps/web/src/main.tsx', 'apps/api/src/index.ts'];

    const runAiReview = Boolean(client && cfg.features.aiReview && cfg.aiHero.executionEnabled);
    if (runAiReview && client) {
      const reviewer = new CodeReviewOrchestrator(client, model);
      const fixer = new AutoFixEngine(reviewer);
      let iter = 0;
      lastReview = await reviewer.runIteration(instruction, skillsBlock, session, reviewPaths);
      reviewText = lastReview.findings.map(f => `[${f.severity}] ${f.file}: ${f.issue}`).join('\n');

      if (!cfg.git.autoCommit) {
        step('ai review', 'Fix loop skipped (sdlc.features.json autoCommit: false); first-pass findings only.');
      } else {
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
      }

      const fullPr =
        prBodyDraft +
        `\n\n## AI Hero code review\n\n${reviewText || 'No findings.'}\n\n## Log (tail)\n\n${logLines.slice(-30).join('\n')}`;
      if (prNumber !== null) {
        await prMgr.updateBody(session, fullPr);
      } else {
        step('github', 'PR description update skipped (no PR number).');
      }
    } else {
      if (!client) {
        reviewText = 'AI review skipped (OPENAI_API_KEY not set).';
      } else if (!cfg.features.aiReview) {
        reviewText = 'AI review skipped (sdlc.features.json aiReview: false).';
      } else if (!cfg.aiHero.executionEnabled) {
        reviewText = 'AI review skipped (AI Hero execution disabled in sdlc.config.ts or features).';
      } else {
        reviewText = 'AI review skipped.';
      }
      if (prNumber !== null) {
        await prMgr.updateBody(session, prBodyDraft + `\n\n## AI Hero code review\n\n${reviewText}\n`);
      }
    }

    state.phase = 'merge';
    await stateMgr.save(cfg.workflow.stateFile, state);

    const blockMergeReview = runAiReview ? blockingReviewFindings(lastReview) : false;
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
      const mr = await mergeMgr.mergePr(session, owner, repo, prNumber!);
      mergeStatus = mr.ok ? 'merged (requested via gh; may be queued pending CI / branch protection)' : mr.message;
      state.mergeAttempted = true;
      state.mergeSucceeded = mr.ok;
    } else if (!mergeCheck.ok) {
      mergeStatus = mergeCheck.reason;
    } else if (!cfg.git.autoMerge) {
      mergeStatus = 'Merge skipped: autoMerge is false (sdlc.features.json or sdlc.config.ts).';
    } else if (!cfg.git.autoPush) {
      mergeStatus = 'Merge skipped: autoPush is false — merge requires a pushed branch.';
    } else if (prNumber === null) {
      mergeStatus =
        'Merge skipped: no PR number (PR was not created — see the github: line above; often gh pr create failed, or autoPr/commit/push was off).';
    } else if (!owner || !repo) {
      mergeStatus =
        'Merge skipped: could not resolve GitHub owner/repo (check origin URL or set GITHUB_OWNER and GITHUB_REPO).';
    } else {
      mergeStatus = 'Merge skipped (policy).';
    }

    state.phase = 'deploy';
    await stateMgr.save(cfg.workflow.stateFile, state);

    const deployLocalEnv = process.env.SDLC_DEPLOY_LOCAL === '1';
    const wantDeploy = cfg.features.autoDeployLocal || deployLocalEnv;
    if (cfg.docker.enabled && state.mergeSucceeded && wantDeploy) {
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
          ? 'Skipped: set autoDeployLocal in sdlc.features.json or SDLC_DEPLOY_LOCAL=1 to run compose after merge.'
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

    const worktreeNote = cfg.git.worktreesEnabled
      ? ' (worktree removed unless SDLC_KEEP_WORKTREE=1)'
      : ' (feature branch removed; main checkout restored)';
    console.log(
      `\nFinished.\n  Report: ${reportPath}${worktreeNote}\n  PR: ${prUrl ?? 'n/a'}\n  Merge: ${mergeStatus}\n`,
    );
  } finally {
    await gitWt.remove(session, origBranch);
  }
}
