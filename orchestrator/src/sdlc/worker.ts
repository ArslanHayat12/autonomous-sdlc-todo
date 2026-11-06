/**
 * Continuous SDLC worker: polls GitHub issues + `tasks/queue.json`, runs one pipeline per task.
 *
 * **Important:** AI Hero skills run in this Node process (read `SKILL.md` into prompts) — not inside Cursor’s agent runtime.
 * A dedicated checkout via **`SDLC_REPO_ROOT`** / `worker.dedicatedRepoPath` avoids touching your dirty Cursor tree.
 */
import path from 'node:path';
import process from 'node:process';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { ConfigurationManager } from './config-manager.js';
import { discoverNextTask } from './task-discovery.js';
import { loadQueueFile, saveQueueFile } from './local-queue-provider.js';
import {
  loadWorkerState,
  removePidFile,
  saveWorkerState,
  workerStatePath,
} from './worker-state.js';
import type { WorkerStateV1 } from './task-types.js';
import { resolveMonorepoRoot, resolvePrimarySyncSourceRoot } from './repo-root.js';
import { runSdlcTask, setPipelineRepoRoots, type SdlcTaskOutcome } from './pipeline.js';
import {
  closeIssue,
  commentOnIssue,
  resolveOwnerRepo,
} from './github-issue-provider.js';
import type { WorktreeSession } from '../worktree.js';
import type { SdlcConfigWithFeatures } from './feature-flags.js';
import { existsSync } from 'node:fs';

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] worker: ${msg}`);
}

function minimalSession(repoRoot: string): WorktreeSession {
  return { path: repoRoot, branch: 'worker', mainRepoRoot: repoRoot, baseSha: 'HEAD' };
}

async function ensureShutdownFileRemoved(abs: string) {
  try {
    await unlink(abs);
  } catch {
    /* ok */
  }
}

export async function runWorkerMain(argv: string[]): Promise<void> {
  const mode = argv[0] ?? 'start';
  const configMgr = new ConfigurationManager();
  const primaryRoot = resolveMonorepoRoot();
  const cfg = await configMgr.get(primaryRoot);

  const workerRepo =
    process.env.SDLC_REPO_ROOT?.trim() ||
    cfg.worker.dedicatedRepoPath?.trim() ||
    primaryRoot;
  const syncPrimary =
    cfg.worker.syncFromPrimaryWorkspace && workerRepo !== primaryRoot
      ? primaryRoot
      : undefined;

  if (mode === 'status') {
    const stPath = workerStatePath(workerRepo, cfg.worker.workerStateFile);
    const s = await loadWorkerState(stPath);
    console.log(
      JSON.stringify(
        {
          repoRoot: workerRepo,
          primaryWorkspace: primaryRoot,
          syncFromPrimary: Boolean(syncPrimary),
          state: s,
          shutdownFile: cfg.worker.shutdownFile,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (mode === 'stop') {
    const shutdownAbs = path.join(workerRepo, cfg.worker.shutdownFile);
    await mkdir(path.dirname(shutdownAbs), { recursive: true });
    await writeFile(shutdownAbs, `${new Date().toISOString()}\n`, 'utf8');
    log(`Wrote shutdown flag ${shutdownAbs}`);
    return;
  }

  if (mode !== 'start') {
    console.error('Usage: worker [start|status|stop]');
    process.exitCode = 1;
    return;
  }

  const shutdownAbs = path.join(workerRepo, cfg.worker.shutdownFile);
  const pidAbs = path.join(workerRepo, cfg.worker.pidFile);
  const stateAbs = workerStatePath(workerRepo, cfg.worker.workerStateFile);
  await ensureShutdownFileRemoved(shutdownAbs);

  let consecutive = 0;
  let running = true;

  const onSig = () => {
    running = false;
    log('Signal received — finishing after current iteration');
  };
  process.on('SIGINT', onSig);
  process.on('SIGTERM', onSig);

  await mkdir(path.dirname(pidAbs), { recursive: true });
  await writeFile(pidAbs, String(process.pid), 'utf8');

  let state: WorkerStateV1 = {
    version: 1,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pid: process.pid,
    processing: null,
    completedCount: 0,
  };

  /** Recover stale lock from prior crash */
  const existing = await loadWorkerState(stateAbs);
  if (existing?.processing?.taskId) {
    log(`Recovering stale processing ${existing.processing.taskId}`);
    await releaseLocalTaskLock(workerRepo, cfg, existing.processing.taskId);
    existing.processing = null;
    state = { ...state, completedCount: existing.completedCount ?? 0 };
  }
  await saveWorkerState(stateAbs, state);

  log(`Started (repo=${workerRepo}${syncPrimary ? `, syncFrom=${syncPrimary}` : ''})`);

  while (running) {
    if (existsSync(shutdownAbs)) {
      log('Shutdown file present — exiting');
      running = false;
      break;
    }

    state.updatedAt = new Date().toISOString();
    await saveWorkerState(stateAbs, state);

    const blockedSet = new Set(state.blockedGithubIssueNumbers ?? []);
    const next = await discoverNextTask(workerRepo, cfg, state.processing?.taskId ?? null, blockedSet);
    if (!next) {
      await sleep(cfg.worker.pollingIntervalMs);
      continue;
    }

    const taskId = next.kind === 'github' ? next.id : next.task.id;
    const instruction =
      next.kind === 'github' ? next.instruction : next.task.instruction;

    state.processing = {
      taskId,
      startedAt: new Date().toISOString(),
      issueNumber: next.kind === 'github' ? next.issueNumber : undefined,
    };
    await saveWorkerState(stateAbs, state);

    if (next.kind === 'local') {
      await patchLocalTaskStatus(workerRepo, cfg, next.task.id, 'processing');
    }

    setPipelineRepoRoots(workerRepo, syncPrimary);

    let attempt = 0;
    const maxAttempts = Math.max(1, cfg.safety.maxTaskRetries + 1);
    let lastErr = '';
    let outcome: SdlcTaskOutcome = {
      ok: false,
      mergeSucceeded: false,
      prUrl: null,
      mergeStatus: 'not attempted',
      blockedReason: undefined,
    };

    while (attempt < maxAttempts) {
      attempt++;
      outcome = await runSdlcTask(instruction, workerRepo, syncPrimary);
      if (outcome.ok) break;
      lastErr = outcome.blockedReason ?? outcome.mergeStatus ?? 'task failed';
      log(`Task not OK (${attempt}/${maxAttempts}): ${lastErr.slice(0, 500)}`);
      if (attempt >= maxAttempts) {
        if (next.kind === 'local') {
          await patchLocalTaskStatus(workerRepo, cfg, next.task.id, 'failed', lastErr);
        } else if (next.kind === 'github') {
          const org = resolveOwnerRepo(minimalSession(workerRepo));
          if (org) {
            commentOnIssue(
              minimalSession(workerRepo),
              org.owner,
              org.repo,
              next.issueNumber,
              `SDLC worker failed after ${maxAttempts} attempts:\n\n\`\`\`\n${lastErr.slice(0, 4000)}\n\`\`\``,
            );
          }
        }
      }
    }

    if (outcome.ok) {
      if (next.kind === 'local') {
        await patchLocalTaskStatus(workerRepo, cfg, next.task.id, 'completed');
      } else if (next.kind === 'github') {
        const org = resolveOwnerRepo(minimalSession(workerRepo));
        if (org) {
          commentOnIssue(
            minimalSession(workerRepo),
            org.owner,
            org.repo,
            next.issueNumber,
            'Closed by SDLC worker after successful run.',
          );
          closeIssue(
            minimalSession(workerRepo),
            org.owner,
            org.repo,
            next.issueNumber,
          );
        }
      }
      state.completedCount++;
      consecutive++;
    } else {
      state.lastError = lastErr.slice(0, 2000);
      if (next.kind === 'local') {
        if (outcome.prUrl) {
          await patchLocalTaskStatus(workerRepo, cfg, next.task.id, 'blocked', lastErr);
        }
      } else if (next.kind === 'github') {
        state.blockedGithubIssueNumbers = [...(state.blockedGithubIssueNumbers ?? []), next.issueNumber];
        const org = resolveOwnerRepo(minimalSession(workerRepo));
        if (org && outcome.prUrl) {
          commentOnIssue(
            minimalSession(workerRepo),
            org.owner,
            org.repo,
            next.issueNumber,
            `SDLC worker: not fully complete — ${lastErr}\nPR: ${outcome.prUrl}`,
          );
        }
      }
    }

    state.processing = null;
    state.lastTaskId = taskId;
    await saveWorkerState(stateAbs, state);

    if (cfg.worker.maxConsecutiveTasks > 0 && consecutive >= cfg.worker.maxConsecutiveTasks) {
      log(`Reached maxConsecutiveTasks=${cfg.worker.maxConsecutiveTasks} — exiting`);
      break;
    }
  }

  await removePidFile(pidAbs);
  state.shutdownRequested = true;
  state.updatedAt = new Date().toISOString();
  state.processing = null;
  await saveWorkerState(stateAbs, state);
  await ensureShutdownFileRemoved(shutdownAbs);
  log('Stopped');
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function patchLocalTaskStatus(
  repoRoot: string,
  cfg: SdlcConfigWithFeatures,
  id: string,
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'blocked',
  lastError?: string,
) {
  const qPath = path.join(repoRoot, cfg.taskSources.localQueueFile);
  const q = await loadQueueFile(qPath);
  const t = q.tasks.find(x => x.id === id);
  if (!t) return;
  t.status = status;
  t.updatedAt = new Date().toISOString();
  if (status === 'processing') t.attempts += 1;
  if (lastError) t.lastError = lastError;
  await saveQueueFile(qPath, q);
}

async function releaseLocalTaskLock(repoRoot: string, cfg: SdlcConfigWithFeatures, taskId: string) {
  const qPath = path.join(repoRoot, cfg.taskSources.localQueueFile);
  const q = await loadQueueFile(qPath);
  const t = q.tasks.find(x => x.id === taskId);
  if (t?.status === 'processing') {
    t.status = 'pending';
    t.updatedAt = new Date().toISOString();
    await saveQueueFile(qPath, q);
  }
}
