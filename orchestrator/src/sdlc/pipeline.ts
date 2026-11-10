import { execFileSync, execSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
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
import { buildCommitMessageWithSkills } from './commit-message-from-skills.js';
import { ReportGenerator } from './report-generator.js';
import { pruneStaleSdlcWorktrees } from './worktree-prune.js';
import { PipelineProgress } from './pipeline-progress.js';
import { buildSdlcPrBody } from './pr-body-builder.js';
import { syncSdlcPrBody } from './sdlc-pr-sync.js';
import { notifySdlcFailure } from './sdlc-notify.js';
import { buildFeatureBranchName } from './feature-branch-name.js';
import { resolveReviewPaths } from './project-profile.js';
import { formatStepBullet, logRunSummary, logSection, logErrorBlock } from './sdlc-log.js';
import type { ExecutionReport, GateResult, SkillInvocation, WorkflowState } from './types.js';
import { parseGitHubRepoFromUrl, resolveRemoteUrl } from '../gh-pr.js';
import type { ReviewResult } from '../review-json.js';
import type { SdlcConfigWithFeatures } from './feature-flags.js';
import { resolveMonorepoRoot, resolvePrimarySyncSourceRoot } from './repo-root.js';

/** Set at each CLI/worker entry (honors `SDLC_REPO_ROOT`, `SDLC_PRIMARY_REPO_ROOT`). */
let activeRepoRoot = resolveMonorepoRoot();
/** Checkout to mirror uncommitted/sync paths from (often primary Cursor workspace when worker uses a clean clone). */
let activeSyncSourceRoot = resolvePrimarySyncSourceRoot();

export function setPipelineRepoRoots(repoRoot: string, syncSourceRoot?: string): void {
  activeRepoRoot = path.resolve(repoRoot);
  activeSyncSourceRoot = syncSourceRoot ? path.resolve(syncSourceRoot) : activeRepoRoot;
}

const logLines: string[] = [];

function trimGitOut(s: string): string {
  return s.trim();
}

function step(name: string, detail: string) {
  const { plain, line } = formatStepBullet(name, detail);
  logLines.push(plain);
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

/**
 * Before `gh pr merge`, align the feature branch with **`origin/<base>`** so GitHub can merge
 * cleanly (fixes “merge commit cannot be cleanly created” when `main` advanced after worktree creation).
 * Set **`SDLC_SKIP_SYNC_BEFORE_MERGE=1`** to skip.
 */
function syncFeatureBranchWithRemoteBase(session: WorktreeSession, baseBranch: string): void {
  if (process.env.SDLC_SKIP_SYNC_BEFORE_MERGE === '1') {
    step('git sync (pre-merge)', 'Skipped (SDLC_SKIP_SYNC_BEFORE_MERGE=1).');
    return;
  }
  const fetchOut = execGit(session.path, ['fetch', 'origin'], true);
  if (fetchOut.startsWith('__GIT_FAIL__')) {
    step('git sync (pre-merge)', `fetch failed: ${fetchOut.slice(0, 400)}`);
    return;
  }
  const remoteBase = `origin/${baseBranch}`;
  const haveRemote = trimGitOut(execGit(session.path, ['rev-parse', '--verify', remoteBase], true));
  if (haveRemote.startsWith('__GIT_FAIL__')) {
    step('git sync (pre-merge)', `Skipped: no ${remoteBase} (${haveRemote.slice(0, 200)}).`);
    return;
  }
  const rb = execGit(session.path, ['rebase', remoteBase], true);
  if (rb.startsWith('__GIT_FAIL__')) {
    execGit(session.path, ['rebase', '--abort'], true);
    throw new Error(
      `Could not rebase ${session.branch} onto ${remoteBase} before merge (resolve conflicts manually and push, or open the PR on GitHub):\n${rb.slice(-2000)}`,
    );
  }
  const pw = execGit(session.path, ['push', '--force-with-lease', '-u', 'origin', session.branch], true);
  if (pw.startsWith('__GIT_FAIL__')) {
    throw new Error(`Push after rebase failed (--force-with-lease): ${pw.slice(-2000)}`);
  }
  step('git sync (pre-merge)', `Rebased onto ${remoteBase} and pushed (--force-with-lease).`);
}

function blockingReviewFindings(r: ReviewResult): boolean {
  return r.findings.some(f => f.severity === 'critical' || f.severity === 'high');
}

function revertReviewPatches(session: WorktreeSession, patchPaths: string[]): void {
  const paths = [...new Set(patchPaths.map(p => p.trim()).filter(Boolean))];
  if (paths.length === 0) {
    execGit(session.path, ['restore', '--source=HEAD', '--staged', '--worktree', '.'], true);
    return;
  }
  for (const p of paths) {
    execGit(session.path, ['checkout', 'HEAD', '--', p], true);
  }
}

type PullMainWhen = 'beforeRun' | 'afterPr' | 'afterMerge';

/**
 * Fast-forward local base branch to origin (safe pull). Skips if not on base, dirty tree, or feature off.
 */
function tryFastForwardMainCheckout(cfg: SdlcConfigWithFeatures, when: PullMainWhen, detail: string): void {
  if (process.env.SDLC_SKIP_AUTO_PULL === '1') {
    return;
  }
  const allow =
    when === 'beforeRun'
      ? cfg.features.autoPullMainBeforeRun
      : when === 'afterPr'
        ? cfg.features.autoPullMainAfterPr
        : cfg.features.autoPullMainAfterMerge;
  if (!allow) return;

  const base = cfg.git.baseBranch;
  const cur = execGit(activeRepoRoot, ['branch', '--show-current'], true).trim();
  if (cur.startsWith('__GIT_FAIL__')) {
    step('git pull (main checkout)', `Skipped (${detail}): could not read current branch.`);
    return;
  }
  if (cur !== base) {
    step('git pull (main checkout)', `Skipped (${detail}): on ${cur}, not ${base}.`);
    return;
  }
  const dirty = execGit(activeRepoRoot, ['status', '--porcelain'], true).trim();
  if (dirty && !dirty.startsWith('__GIT_FAIL__')) {
    step('git pull (main checkout)', `Skipped (${detail}): ${base} has uncommitted changes.`);
    return;
  }
  const fetchOut = execGit(activeRepoRoot, ['fetch', 'origin'], true);
  if (fetchOut.startsWith('__GIT_FAIL__')) {
    step('git pull (main checkout)', `fetch failed (${detail}): ${fetchOut.slice(0, 280)}`);
    return;
  }
  const mergeOut = execGit(activeRepoRoot, ['merge', '--ff-only', `origin/${base}`], true);
  if (mergeOut.startsWith('__GIT_FAIL__')) {
    step(
      'git pull (main checkout)',
      `Fast-forward not possible (${detail}): ${mergeOut.slice(0, 400)}`,
    );
    return;
  }
  step('git pull (main checkout)', `Fast-forwarded ${base} to origin/${base} (${detail}).`);
}

/**
 * After a successful merge: **hard reset** local `baseBranch` to `origin/<baseBranch>` so uncommitted noise is cleared.
 * Requires currently on `baseBranch` and a **clean** working tree (otherwise skipped — unsafe).
 */
function resetMainCheckoutToOriginAfterMerge(cfg: SdlcConfigWithFeatures): void {
  if (process.env.SDLC_SKIP_RESET_MAIN_AFTER_MERGE === '1' || !cfg.features.resetMainCheckoutAfterMerge) {
    return;
  }
  const base = cfg.git.baseBranch;
  const cur = execGit(activeRepoRoot, ['branch', '--show-current'], true).trim();
  if (cur.startsWith('__GIT_FAIL__')) {
    step('git reset (main after merge)', 'Skipped: could not read current branch.');
    return;
  }
  if (cur !== base) {
    step('git reset (main after merge)', `Skipped: on ${cur}, not ${base} — switch manually if you want a clean ${base}.`);
    return;
  }
  const dirty = execGit(activeRepoRoot, ['status', '--porcelain'], true).trim();
  if (dirty && !dirty.startsWith('__GIT_FAIL__')) {
    step(
      'git reset (main after merge)',
      `Skipped: ${base} has uncommitted changes (would lose work). Commit/stash or set SDLC_SKIP_RESET_MAIN_AFTER_MERGE=1.`,
    );
    return;
  }
  const fetchOut = execGit(activeRepoRoot, ['fetch', 'origin'], true);
  if (fetchOut.startsWith('__GIT_FAIL__')) {
    step('git reset (main after merge)', `fetch failed: ${fetchOut.slice(0, 320)}`);
    return;
  }
  const hard = execGit(activeRepoRoot, ['reset', '--hard', `origin/${base}`], true);
  if (hard.startsWith('__GIT_FAIL__')) {
    step('git reset (main after merge)', `reset failed: ${hard.slice(0, 400)}`);
    return;
  }
  step('git reset (main after merge)', `Hard-reset ${base} to origin/${base} (cleared local drift).`);
}

/**
 * Force local **`git.baseBranch`** to match **`origin/<base>`** (fetch + checkout -f + reset --hard).
 * Runs after each run when **`alignMainWithRemoteAfterRun`** is true — clears conflicts / dirty state on that branch.
 * Skip with **`SDLC_SKIP_ALIGN_MAIN_AFTER_RUN=1`**. Untracked cleanup only if **`SDLC_CLEAN_UNTRACKED_AFTER_ALIGN=1`**.
 */
function alignMainCheckoutWithRemote(cfg: SdlcConfigWithFeatures): void {
  if (process.env.SDLC_SKIP_ALIGN_MAIN_AFTER_RUN === '1' || !cfg.features.alignMainWithRemoteAfterRun) {
    return;
  }
  const base = cfg.git.baseBranch;
  const fetchOut = execGit(activeRepoRoot, ['fetch', 'origin'], true);
  if (fetchOut.startsWith('__GIT_FAIL__')) {
    step('git align (base)', `fetch failed: ${fetchOut.slice(0, 320)}`);
    return;
  }
  const co = execGit(activeRepoRoot, ['checkout', '-f', base], true);
  if (co.startsWith('__GIT_FAIL__')) {
    step('git align (base)', `checkout failed: ${co.slice(0, 400)}`);
    return;
  }
  const hard = execGit(activeRepoRoot, ['reset', '--hard', `origin/${base}`], true);
  if (hard.startsWith('__GIT_FAIL__')) {
    step('git align (base)', `reset failed: ${hard.slice(0, 400)}`);
    return;
  }
  step('git align (base)', `Aligned ${base} to origin/${base} (hard reset).`);
  if (process.env.SDLC_CLEAN_UNTRACKED_AFTER_ALIGN === '1') {
    const cl = execGit(activeRepoRoot, ['clean', '-fd'], true);
    if (!cl.startsWith('__GIT_FAIL__')) {
      step('git align (base)', 'Removed untracked files (git clean -fd).');
    }
  }
}

/**
 * Optional **human-free** gate: verify the main checkout (e.g. `npm run build`) before branching to SDLC worktree.
 * Skip with `SDLC_SKIP_MAIN_VERIFY=1` or `runMainRepoVerificationBeforeSdlc: false`.
 */
function runMainRepoVerificationIfEnabled(cfg: SdlcConfigWithFeatures): void {
  if (process.env.SDLC_SKIP_MAIN_VERIFY === '1' || !cfg.features.runMainRepoVerificationBeforeSdlc) {
    return;
  }
  const cmd = (process.env.SDLC_VERIFY_COMMAND ?? cfg.features.mainRepoVerificationCommand).trim();
  if (!cmd) {
    step('verify (main checkout)', 'Skipped (empty command).');
    return;
  }
  step('verify (main checkout)', `Running: ${cmd}`);
  const shell = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : '/bin/sh';
  try {
    execSync(cmd, {
      cwd: activeRepoRoot,
      stdio: 'pipe',
      encoding: 'utf8',
      env: process.env,
      shell,
      maxBuffer: 32 * 1024 * 1024,
    });
    step('verify (main checkout)', 'Passed.');
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const tail = [err.stdout, err.stderr].filter(Boolean).join('\n').slice(-4000);
    throw new Error(
      `Main checkout verification failed (runMainRepoVerificationBeforeSdlc). Command: ${cmd}\n${tail || err.message || String(e)}`,
    );
  }
}

export async function runSdlcFromArgv(argv: string[]): Promise<void> {
  setPipelineRepoRoots(resolveMonorepoRoot(), resolvePrimarySyncSourceRoot());
  const configMgr = new ConfigurationManager();
  const cfg = await configMgr.get(activeRepoRoot);
  const parsed = parseArgv(argv);
  const stateMgr = new WorkflowStateManager(activeRepoRoot);

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
    const short = execGit(activeRepoRoot, ['rev-parse', '--short', 'HEAD']).trim();
    const r = dep.deployLocal(activeRepoRoot, short);
    step('deploy-only', r.output.slice(-3000));
    const health = dm.healthChecks();
    console.log(JSON.stringify({ health }, null, 2));
    return;
  }

  if (parsed.mode === 'publish') {
    await runPublishOnlyPipeline(parsed, cfg, stateMgr);
    return;
  }

  try {
    await runFullPipeline(parsed, cfg, stateMgr);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logErrorBlock('SDLC failed', [msg]);
    process.exitCode = 1;
    throw e;
  }
}

/**
 * **Publish** working-tree edits (e.g. from Cursor agent): commit on a new branch, push, PR, merge.
 * Does **not** run SDLC plan/AI implementation. Requires **`isolatedWorktree: false`** (uses main checkout).
 */
async function runPublishOnlyPipeline(
  parsed: ParsedArgv,
  cfg: SdlcConfigWithFeatures,
  stateMgr: WorkflowStateManager,
): Promise<void> {
  const instruction = parsed.instruction;
  const mergeMgr = new MergeManager(cfg);
  const prMgr = new PullRequestManager(cfg);
  const reportGen = new ReportGenerator();
  const commitGen = new CommitMessageGenerator();
  const gateOrch = new QualityGateOrchestrator(cfg.qualityGates);
  const testRunner = new TestRunner();

  const state: WorkflowState = {
    version: 1,
    startedAt: new Date().toISOString(),
    instruction,
    phase: 'plan',
  };
  await stateMgr.save(cfg.workflow.stateFile, state);

  step('mode', 'publish — commit local changes, push, PR, merge (no SDLC AI implementation)');
  const origBranch = execGit(activeRepoRoot, ['branch', '--show-current'], true).trim() || '(detached)';

  if (cfg.git.worktreesEnabled) {
    console.error(
      'publish mode requires isolatedWorktree: false in sdlc.features.json (main-checkout branch). Or run full npm run sdlc.',
    );
    process.exitCode = 1;
    return;
  }

  tryFastForwardMainCheckout(cfg, 'beforeRun', 'before publish');
  runMainRepoVerificationIfEnabled(cfg);

  const dirty = execGit(activeRepoRoot, ['status', '--porcelain'], true).trim();
  if (!dirty || dirty.startsWith('__GIT_FAIL__')) {
    step('publish', 'Nothing to commit — working tree clean. Make edits first, then re-run with --publish.');
    process.exitCode = 1;
    return;
  }

  const baseSha = execGit(activeRepoRoot, ['rev-parse', 'HEAD'], true).trim();
  const featureBranch = buildFeatureBranchName(instruction, {
    naming: cfg.git.featureBranchNaming,
    legacyPrefix: cfg.git.featureBranchPrefix,
    scope: cfg.git.featureBranchScope,
    publish: true,
  });
  step('git branch', featureBranch);

  execGit(activeRepoRoot, ['checkout', '-b', featureBranch]);
  const session: WorktreeSession = { path: activeRepoRoot, branch: featureBranch, mainRepoRoot: activeRepoRoot, baseSha };
  state.featureBranch = featureBranch;
  state.baseSha = baseSha;
  state.phase = 'implement';
  await stateMgr.save(cfg.workflow.stateFile, state);

  let mergeSucceeded = false;
  const title = commitGen.generateTitle('agent', instruction);
  const body = commitGen.generateBody({
    why: instruction,
    what: 'Published from local working tree (`--publish`); no SDLC plan/AI implementation.',
    components: [],
    architecture: 'Feature branch created from current HEAD in main checkout.',
    security: '',
    tests: cfg.features.qualityGates ? 'Quality gates from sdlc.config.ts (when enabled).' : 'Gates skipped (sdlc.features.json qualityGates: false).',
    breaking: 'None intended.',
  });

  let prUrl: string | null = null;
  let prNumber: number | null = null;
  let mergeStatus = 'not attempted';
  const gateResults: GateResult[] = [];

  try {
    let committed = false;
    if (!cfg.git.autoCommit) {
      step('git commit', 'Skipped (autoCommit false).');
    } else {
      committed = await gitCommitAll(session, title, body);
    }
    if (!committed) {
      step('publish', 'No commit created — aborting.');
      process.exitCode = 1;
      return;
    }

    state.phase = 'validate';
    await stateMgr.save(cfg.workflow.stateFile, state);

    if (cfg.features.qualityGates) {
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
    } else {
      step('quality gates', 'Skipped (sdlc.features.json qualityGates: false).');
    }

    const { files: changedFiles } = commitGen.describeDiff(session.path);
    const commitSha = execGit(session.path, ['rev-parse', 'HEAD']).trim();
    state.commitSha = commitSha;

    state.phase = 'pr';
    await stateMgr.save(cfg.workflow.stateFile, state);

    if (!cfg.git.autoPush || !cfg.git.autoCommit) {
      step('github', 'PR skipped: need autoCommit and autoPush.');
    } else {
      const prBody = [
        `## Instruction`,
        instruction,
        ``,
        `## Mode`,
        `**publish** — committed local working tree; no SDLC AI implementation.`,
        ``,
        `## Files`,
        changedFiles.map(f => `- \`${f}\``).join('\n') || '(see diff)',
      ].join('\n');
      const pr = await prMgr.createOrUpdate(session, instruction, prBody);
      prUrl = pr.prUrl;
      prNumber = pr.prNumber;
      step('github', pr.message);
      tryFastForwardMainCheckout(cfg, 'afterPr', 'after PR opened');
    }

    state.phase = 'merge';
    await stateMgr.save(cfg.workflow.stateFile, state);

    const mergeCheck = mergeMgr.canAutoMerge(gateResults, false);
    const remote = resolveRemoteUrl(session);
    const repoIds = remote ? parseGitHubRepoFromUrl(remote) : null;
    const owner = process.env.GITHUB_OWNER ?? repoIds?.owner;
    const repo = process.env.GITHUB_REPO ?? repoIds?.repo;

    const canMerge =
      cfg.git.autoMerge &&
      !cfg.features.requireHumanApprovalBeforeMerge &&
      mergeCheck.ok &&
      cfg.git.autoPush &&
      prNumber !== null &&
      owner &&
      repo;

    if (canMerge) {
      let syncOk = true;
      try {
        syncFeatureBranchWithRemoteBase(session, cfg.git.baseBranch);
      } catch (e) {
        syncOk = false;
        mergeStatus = `Pre-merge sync failed: ${e instanceof Error ? e.message : String(e)}`;
      }
      if (syncOk) {
        const mr = await mergeMgr.mergePr(session, owner!, repo!, prNumber!);
        mergeStatus = mr.ok ? 'merged (requested via gh; may be queued pending CI / branch protection)' : mr.message;
        mergeSucceeded = mr.ok;
        if (mr.ok) {
          tryFastForwardMainCheckout(cfg, 'afterMerge', 'after merge on remote — update local main');
          resetMainCheckoutToOriginAfterMerge(cfg);
          execGit(activeRepoRoot, ['checkout', cfg.git.baseBranch], true);
          execGit(activeRepoRoot, ['branch', '-D', featureBranch], true);
          step('git cleanup', `Checked out ${cfg.git.baseBranch} and deleted local ${featureBranch}.`);
        }
      }
    } else if (!mergeCheck.ok) {
      mergeStatus = mergeCheck.reason;
    } else if (!cfg.git.autoMerge) {
      mergeStatus = 'Merge skipped: autoMerge is false.';
    } else if (prNumber === null) {
      mergeStatus = 'Merge skipped: no PR.';
    } else {
      mergeStatus = 'Merge skipped (policy).';
    }

    state.phase = 'done';
    await stateMgr.save(cfg.workflow.stateFile, state);

    const report: ExecutionReport = {
      originalBranch: origBranch,
      featureBranch,
      baseSha,
      selectedSkills: [],
      skillInvocations: [],
      implementationSummary: 'publish mode — existing working tree only',
      filesChanged: changedFiles,
      commitSha,
      commitMessage: `${title}\n\n${body}`,
      prUrl,
      reviewFindings: '',
      gateResults,
      mergeStatus,
      deploymentStatus: 'Skipped (--publish).',
      healthResults: [],
    };
    const reportPath = await reportGen.writeMarkdown(activeRepoRoot, cfg.workflow.reportDir, report);
    step('report', reportPath);
    logRunSummary([
      { label: 'Mode', value: 'publish' },
      { label: 'Report', value: reportPath },
      { label: 'PR', value: prUrl ?? 'n/a', tone: prUrl ? 'ok' : 'skip' },
      { label: 'Merge', value: mergeStatus, tone: mergeStatus.includes('merged') ? 'ok' : 'info' },
    ]);
  } catch (e) {
    state.phase = 'failed';
    await stateMgr.save(cfg.workflow.stateFile, state);
    throw e;
  } finally {
    if (!mergeSucceeded) {
      const cur = execGit(activeRepoRoot, ['branch', '--show-current'], true).trim();
      if (cur === featureBranch) {
        if (origBranch && origBranch !== '(detached)' && !origBranch.startsWith('__GIT_FAIL__')) {
          execGit(activeRepoRoot, ['checkout', origBranch], true);
          step('git cleanup', `Restored branch ${origBranch}.`);
        }
        execGit(activeRepoRoot, ['branch', '-D', featureBranch], true);
        step('git cleanup', `Deleted local branch ${featureBranch}.`);
      }
    }
    alignMainCheckoutWithRemote(cfg);
  }
}

export type SdlcTaskOutcome = {
  ok: boolean;
  mergeSucceeded: boolean;
  prUrl: string | null;
  mergeStatus: string;
  blockedReason?: string;
};

async function runFullPipeline(
  parsed: ParsedArgv,
  cfg: SdlcConfigWithFeatures,
  stateMgr: WorkflowStateManager,
): Promise<SdlcTaskOutcome> {
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

  logSection('SDLC pipeline');
  step('instruction', instruction);
  const origBranch = execGit(activeRepoRoot, ['branch', '--show-current'], true).trim() || '(detached)';
  step(
    'git isolation',
    cfg.git.worktreesEnabled
      ? `Main checkout preserved; linked worktrees under ${path.join(activeRepoRoot, cfg.git.worktreesDirectory)}.`
      : `In-place branch mode (sdlc.features.json isolatedWorktree: false); will restore ${origBranch} after run.`,
  );

  await pruneStaleSdlcWorktrees(activeRepoRoot, cfg);
  step('worktree prune', 'Stale sdlc worktrees removed when enabled in sdlc.config.ts (frees disk).');

  tryFastForwardMainCheckout(cfg, 'beforeRun', 'before worktree');

  runMainRepoVerificationIfEnabled(cfg);

  const baseSha = gitWt.resolveBaseSha(activeRepoRoot);
  step('git base', `Using base ${baseSha} (config baseBranch=${branchMgr.baseBranch})`);
  state.baseSha = baseSha;

  const session = await gitWt.create(activeRepoRoot, baseSha, instruction);
  step('git branch', session.branch);
  state.featureBranch = session.branch;
  await stateMgr.save(cfg.workflow.stateFile, state);

  const progress = new PipelineProgress('full');
  progress.mark('worktree', 'succeeded', session.branch);

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

  let outcome: SdlcTaskOutcome = {
    ok: false,
    mergeSucceeded: false,
    prUrl: null,
    mergeStatus: 'not attempted',
  };

  try {
    step('worktree', `${session.path} branch ${session.branch}`);

    if (session.path !== activeRepoRoot) {
      const syncFrom = activeSyncSourceRoot === activeRepoRoot ? activeRepoRoot : activeSyncSourceRoot;
      if (syncFrom !== activeRepoRoot) {
        step('sync source', `Using SDLC_WORKER_SYNC_FROM_PRIMARY: mirroring from ${syncFrom}`);
      }
      const synced = await syncWorkingTreeFilesIntoWorktree(syncFrom, session.path, [...cfg.syncPathsFromMain]);
      if (synced.length) step('sync from main checkout', synced.join(', '));
      if (cfg.features.syncUncommittedFromMain) {
        const u = await syncUncommittedFromMain(syncFrom, session.path);
        const parts: string[] = [];
        if (u.copied.length) parts.push(`copied ${u.copied.length} (${u.copied.slice(0, 8).join(', ')}${u.copied.length > 8 ? '…' : ''})`);
        if (u.deleted.length) parts.push(`removed ${u.deleted.length} in worktree`);
        if (u.skipped.length) parts.push(`skipped ${u.skipped.length}`);
        step('sync uncommitted from main', parts.length ? parts.join('; ') : 'none');
      }
    } else {
      step('sync from main checkout', 'Skipped (session path is main repo — already the same tree).');
    }
    progress.mark('sync', 'succeeded');

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
      progress.mark('skills', 'skipped', 'aiHeroSkills disabled');
    }
    const selected = discovered.filter(s => selectedIds.includes(s.id));
    if (cfg.features.aiHeroSkills) {
      progress.mark(
        'skills',
        'succeeded',
        selectedIds.length ? selectedIds.join(', ') : 'no SKILL.md matches',
      );
    }

    const skillsBlock = formatSkillsForPrompt(selected);
    await mkdir(path.join(session.path, 'artifacts'), { recursive: true });

    const planner = new ImplementationPlanner(client, model);
    const planMd = await planner.plan(instruction, selected, path.join(session.path, 'package.json'));
    await writeFile(path.join(session.path, 'artifacts', 'plan.md'), `# Plan\n\n${planMd}\n`);
    progress.mark('plan', 'succeeded');
    state.phase = 'implement';
    await stateMgr.save(cfg.workflow.stateFile, state);

    if (!cfg.features.autoImplement) {
      implementationSummary = 'Auto-implement disabled (sdlc.features.json autoImplement: false); no code edits applied.';
      step('implement', implementationSummary);
      progress.mark('implement', 'skipped', 'autoImplement false');
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
          progress.mark('implement', 'failed', `build failed after ${implAttempt} attempts`);
          throw new Error(`Implementation failed build after ${implAttempt} attempts: ${buildTry.output.slice(-2000)}`);
        }
      }
    }
    progress.mark('implement', 'succeeded', implementationSummary.slice(0, 200) || 'done');

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
      await gateOrch.runGate('dockerBuild', activeRepoRoot, async () => {
        if (!cfg.qualityGates.dockerBuild.enabled) {
          return { ok: false, output: 'docker build gate disabled (not executed).' };
        }
        const short = execGit(session.path, ['rev-parse', '--short', 'HEAD']).trim();
        dockerTag = cfg.docker.imageTagTemplate.replace('{{shortSha}}', short);
        return dockerMgr.build(activeRepoRoot, dockerTag);
      }),
    );

    const mandatoryGateFailed = gateResults.some(g => g.mandatory && g.status === 'failed');
    const gateDetail = gateResults.map(g => `${g.id}:${g.status}`).join(', ');
    progress.mark(
      'validate',
      mandatoryGateFailed ? 'failed' : 'succeeded',
      gateDetail.slice(0, 240) || 'gates complete',
    );

    const gateSummary = gateResults
      .map(g => `- **${g.id}**: ${g.status}${g.mandatory ? ' (mandatory)' : ' (optional)'} — ${g.output.slice(0, 120)}…`)
      .join('\n');

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

    const useSkillCommit =
      Boolean(client) && cfg.features.aiHeroSkills && cfg.features.autoCommitMessageFromSkills && selectedIds.length > 0;
    const { title, body: commitBody } = useSkillCommit
      ? await buildCommitMessageWithSkills({
          client,
          model,
          instruction,
          selectedSkills: selected,
          implementationSummary,
          gateSummary,
          fallbackBody: bodyParts,
        })
      : {
          title: commitGen.generateTitle('sdlc', implementationSummary || instruction),
          body: commitGen.generateBody(bodyParts),
        };
    if (useSkillCommit) {
      step('commit message', 'Drafted from OpenAI + selected Hero skills (sdlc.features.json autoCommitMessageFromSkills).');
    }

    let committed = false;
    if (!cfg.git.autoCommit) {
      step('git commit', 'Skipped (sdlc.features.json autoCommit: false). Changes may be uncommitted in the session directory.');
      progress.mark('commit', 'skipped', 'autoCommit false');
    } else {
      committed = await gitCommitAll(session, title, commitBody);
      if (!committed) {
        step('git commit', 'No changes to commit after gates.');
        progress.mark('commit', 'skipped', 'no diff');
      } else {
        progress.mark('commit', 'succeeded', title.slice(0, 120));
      }
    }
    if (cfg.git.autoPush) {
      if (!cfg.git.autoCommit) {
        step('git push', 'Skipped (autoCommit is false in sdlc.features.json — commit locally before pushing).');
        progress.mark('push', 'skipped', 'needs autoCommit');
      } else if (!committed) {
        step('git push', 'Skipped (no new commit).');
        progress.mark('push', 'skipped', 'no commit');
      } else {
        try {
          gitPush(session);
          progress.mark('push', 'succeeded', session.branch);
        } catch (e) {
          const pem = e instanceof Error ? e.message : String(e);
          step('git push', `Failed: ${pem}`);
          progress.mark('push', 'failed', pem.slice(0, 200));
        }
      }
    } else {
      step('git push', 'Skipped (sdlc.features.json autoPush: false).');
      progress.mark('push', 'skipped', 'autoPush false');
    }

    const commitSha = execGit(session.path, ['rev-parse', 'HEAD']).trim();
    const { stat: diffStat, files: changedFiles } = commitGen.describeDiff(session.path);
    state.commitSha = commitSha;
    state.phase = 'pr';
    await stateMgr.save(cfg.workflow.stateFile, state);

    const prBodyBase = {
      instruction,
      mode: 'full' as const,
      progress,
      selectedSkillIds: selectedIds,
      skillInvocations,
      implementationSummary,
      gateResults,
      changedFiles: changedFiles.length ? changedFiles : (diffStat ? [diffStat] : []),
      featureBranch: session.branch,
      commitSha,
    };

    if (cfg.git.autoCreatePr) {
      if (!cfg.git.autoPush || !cfg.git.autoCommit) {
        step(
          'github',
          'PR creation skipped: autoPr needs both autoCommit and autoPush (see sdlc.features.json).',
        );
      } else if (!committed) {
        step('github', 'PR creation skipped: no commit was pushed.');
        progress.mark('pr', 'skipped', 'no commit');
      } else {
        const pr = await prMgr.createOrUpdate(
          session,
          instruction,
          buildSdlcPrBody({ ...prBodyBase, reviewText: undefined, mergeStatus: undefined }),
        );
        prUrl = pr.prUrl;
        prNumber = pr.prNumber;
        state.prUrl = prUrl;
        state.prNumber = prNumber;
        step('github', pr.message);
        if (pr.prNumber !== null) {
          progress.mark('pr', 'succeeded', pr.prUrl ?? `PR #${pr.prNumber}`);
          await syncSdlcPrBody(prMgr, cfg, session, prNumber, prBodyBase, 'pr');
        } else {
          progress.mark('pr', 'failed', pr.message.slice(0, 200));
        }
        tryFastForwardMainCheckout(cfg, 'afterPr', 'after PR opened — local main may include merge');
      }
    } else {
      step('github', 'PR creation skipped (sdlc.features.json autoPr: false).');
      progress.mark('pr', 'skipped', 'autoPr false');
    }

    state.phase = 'review';
    await stateMgr.save(cfg.workflow.stateFile, state);

    const reviewPaths = resolveReviewPaths(cfg.project);

    const runAiReview = Boolean(client && cfg.features.aiReview && cfg.aiHero.executionEnabled);
    if (runAiReview && client) {
      const reviewer = new CodeReviewOrchestrator(client, model);
      const fixer = new AutoFixEngine(reviewer);
      let iter = 0;
      lastReview = await reviewer.runIteration(instruction, skillsBlock, session, reviewPaths);
      reviewText = lastReview.findings.map(f => `[${f.severity}] ${f.file}: ${f.issue}`).join('\n');

      if (!cfg.git.autoCommit) {
        step('ai review', 'Fix loop skipped (sdlc.features.json autoCommit: false); first-pass findings only.');
      } else if (process.env.SDLC_SKIP_REVIEW_AUTO_FIX === '1') {
        step('ai review', 'Auto-fix patches skipped (SDLC_SKIP_REVIEW_AUTO_FIX=1); findings only.');
      } else {
        const buildCmd = cfg.project.commands.build.trim() || 'npm run build';
        while (iter < cfg.workflow.maxAiReviewIterations) {
          const patchPaths = lastReview.patches?.map(p => p.path) ?? [];
          const applied = await fixer.applyPatchesIfAny(session, lastReview);
          if (applied) {
            const b = testRunner.runShell(session.path, buildCmd, cfg.qualityGates.build.timeoutMs);
            if (!b.ok) {
              revertReviewPatches(session, patchPaths);
              const tail = b.output.slice(-1200);
              step(
                'ai review',
                `Auto-fix iteration ${iter + 1} reverted — build failed after review patches. See output below.`,
              );
              reviewText = [
                reviewText,
                '',
                `_Auto-fix iteration ${iter + 1} was **reverted** because \`${buildCmd}\` failed._`,
                '```',
                tail,
                '```',
              ].join('\n');
              lastReview = { ...lastReview, needsMoreChanges: false, patches: [] };
              break;
            }
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

      const reviewOk = !blockingReviewFindings(lastReview);
      progress.mark(
        'review',
        reviewOk ? 'succeeded' : 'failed',
        reviewOk ? 'no blocking findings' : 'critical/high findings remain',
      );
      if (prNumber !== null) {
        await syncSdlcPrBody(
          prMgr,
          cfg,
          session,
          prNumber,
          {
            ...prBodyBase,
            reviewText: `${reviewText || 'No findings.'}\n\n## Log (tail)\n\n${logLines.slice(-30).join('\n')}`,
            mergeStatus: undefined,
          },
          'review',
        );
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
      progress.mark('review', 'skipped', reviewText.slice(0, 120));
      if (prNumber !== null) {
        await syncSdlcPrBody(prMgr, cfg, session, prNumber, {
          ...prBodyBase,
          reviewText,
          mergeStatus: undefined,
        });
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
      !cfg.features.requireHumanApprovalBeforeMerge &&
      mergeCheck.ok &&
      cfg.git.autoPush &&
      prNumber !== null &&
      owner &&
      repo;

    if (canMerge) {
      let syncOk = true;
      progress.markRunning('pre-merge-sync');
      try {
        syncFeatureBranchWithRemoteBase(session, cfg.git.baseBranch);
        progress.mark('pre-merge-sync', 'succeeded');
      } catch (e) {
        syncOk = false;
        const pem = e instanceof Error ? e.message : String(e);
        mergeStatus = `Pre-merge sync failed: ${pem}`;
        progress.mark('pre-merge-sync', 'failed', pem.slice(0, 200));
        state.mergeAttempted = true;
        state.mergeSucceeded = false;
      }
      if (syncOk) {
        const mr = await mergeMgr.mergePr(session, owner, repo, prNumber!);
        mergeStatus = mr.ok ? 'merged (requested via gh; may be queued pending CI / branch protection)' : mr.message;
        state.mergeAttempted = true;
        state.mergeSucceeded = mr.ok;
        progress.mark('merge', mr.ok ? 'succeeded' : 'failed', mergeStatus.slice(0, 200));
        if (mr.ok) {
          tryFastForwardMainCheckout(cfg, 'afterMerge', 'after merge on remote — update local main');
          resetMainCheckoutToOriginAfterMerge(cfg);
        }
      }
    } else if (cfg.features.requireHumanApprovalBeforeMerge && mergeCheck.ok && prNumber !== null && owner && repo) {
      mergeStatus =
        'Merge skipped: requireHumanApprovalBeforeMerge is true — merge on GitHub manually (agent finished PR).';
    } else if (!mergeCheck.ok) {
      mergeStatus = mergeCheck.reason;
    } else if (!cfg.git.autoMerge) {
      mergeStatus = 'Merge skipped: autoMerge is false (sdlc.features.json or sdlc.config.ts).';
    } else if (cfg.features.requireHumanApprovalBeforeMerge) {
      mergeStatus = 'Merge skipped: requireHumanApprovalBeforeMerge is true.';
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
    if (!canMerge) {
      progress.mark('pre-merge-sync', 'skipped', 'merge not attempted');
      progress.mark('merge', 'skipped', mergeStatus.slice(0, 200));
    }

    if (prNumber !== null) {
      await syncSdlcPrBody(prMgr, cfg, session, prNumber, {
        ...prBodyBase,
        reviewText,
        mergeStatus,
      });
    }

    state.phase = 'deploy';
    await stateMgr.save(cfg.workflow.stateFile, state);

    const deployLocalEnv = process.env.SDLC_DEPLOY_LOCAL === '1';
    const wantDeploy = cfg.features.autoDeployLocal || deployLocalEnv;
    let deployAttempted = false;
    if (cfg.docker.enabled && state.mergeSucceeded && wantDeploy) {
      const short = execGit(activeRepoRoot, ['rev-parse', '--short', 'HEAD']).trim();
      const dep = deployMgr.deployLocal(activeRepoRoot, short);
      deployStatus = dep.ok ? 'docker compose up -d --build' : dep.output.slice(-2000);
      healthResults.push(...dockerMgr.healthChecks());
      state.deployAttempted = true;
      deployAttempted = true;
      const deployOk = dep.ok && !healthResults.some(x => !x.ok);
      progress.mark('deploy', deployOk ? 'succeeded' : 'failed', deployStatus.slice(0, 200));
      if (healthResults.some(x => !x.ok) && cfg.docker.rollbackOnFailedHealth) {
        rollbackStatus = rollbackMgr.down(activeRepoRoot);
      }
    } else {
      deployStatus =
        cfg.docker.enabled && state.mergeSucceeded
          ? 'Skipped: set autoDeployLocal in sdlc.features.json or SDLC_DEPLOY_LOCAL=1 to run compose after merge.'
          : 'Skipped (merge not succeeded or Docker disabled).';
      progress.mark('deploy', 'skipped', deployStatus.slice(0, 200));
    }

    if (prNumber !== null) {
      await syncSdlcPrBody(prMgr, cfg, session, prNumber, {
        ...prBodyBase,
        reviewText,
        mergeStatus,
      });
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
    const reportPath = await reportGen.writeMarkdown(activeRepoRoot, cfg.workflow.reportDir, report);
    step('report', reportPath);

    const worktreeNote = cfg.git.worktreesEnabled
      ? ' (worktree removed unless SDLC_KEEP_WORKTREE=1)'
      : ' (feature branch removed; main checkout restored)';
    logRunSummary([
      { label: 'Report', value: `${reportPath}${worktreeNote}` },
      { label: 'PR', value: prUrl ?? 'n/a', tone: prUrl ? 'ok' : 'skip' },
      { label: 'Merge', value: mergeStatus, tone: state.mergeSucceeded ? 'ok' : 'info' },
      { label: 'Deploy', value: deployStatus, tone: deployStatus.includes('Skipped') ? 'skip' : 'ok' },
    ]);

    const mandatoryFailed = gateResults.some(g => g.mandatory && g.status === 'failed');
    const mergeOk = state.mergeSucceeded === true;
    const deployOk =
      !deployAttempted ||
      (deployStatus === 'docker compose up -d --build' && !healthResults.some(x => !x.ok));

    outcome = {
      ok: !mandatoryFailed && mergeOk && deployOk,
      mergeSucceeded: mergeOk,
      prUrl,
      mergeStatus,
      blockedReason: mandatoryFailed
        ? 'Mandatory quality gate failed'
        : !mergeOk
          ? mergeStatus
          : deployAttempted && !deployOk
            ? `Deploy/health: ${deployStatus.slice(0, 400)}`
            : undefined,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const remote = resolveRemoteUrl(session);
    const repoIds = remote ? parseGitHubRepoFromUrl(remote) : null;
    const owner = process.env.GITHUB_OWNER ?? repoIds?.owner ?? null;
    const repo = process.env.GITHUB_REPO ?? repoIds?.repo ?? null;
    if (cfg.github.notifyOnFailure !== false) {
      await notifySdlcFailure({
        repoRoot: activeRepoRoot,
        session,
        owner,
        repo,
        prNumber,
        prUrl,
        instruction,
        error: msg,
        progress,
      });
    }
    throw e;
  } finally {
    await gitWt.remove(session, origBranch);
    alignMainCheckoutWithRemote(cfg);
  }
  return outcome;
}

/**
 * Run the **full** SDLC pipeline for a single instruction (worker / programmatic).
 * Optional **`repoRoot`** / **`syncSourceRoot`** override the active git checkout and uncommitted sync source.
 */
export async function runSdlcTask(
  instruction: string,
  repoRoot?: string,
  syncSourceRoot?: string,
): Promise<SdlcTaskOutcome> {
  if (repoRoot) setPipelineRepoRoots(repoRoot, syncSourceRoot);
  else setPipelineRepoRoots(resolveMonorepoRoot(), resolvePrimarySyncSourceRoot());
  const configMgr = new ConfigurationManager();
  const cfg = await configMgr.get(activeRepoRoot);
  const stateMgr = new WorkflowStateManager(activeRepoRoot);
  const parsed: ParsedArgv = { mode: 'full', instruction };
  try {
    return await runFullPipeline(parsed, cfg, stateMgr);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      mergeSucceeded: false,
      prUrl: null,
      mergeStatus: 'pipeline error',
      blockedReason: msg.slice(0, 2000),
    };
  }
}
