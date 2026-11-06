import type { WorktreeSession } from '../worktree.js';
import type { SdlcConfigWithFeatures } from './feature-flags.js';
import { listOpenIssues, resolveOwnerRepo } from './github-issue-provider.js';
import { loadQueueFile } from './local-queue-provider.js';
import type { TaskRecord } from './task-types.js';
import path from 'node:path';

function minimalSession(repoRoot: string): WorktreeSession {
  return { path: repoRoot, branch: 'worker', mainRepoRoot: repoRoot, baseSha: 'HEAD' };
}

export type DiscoveredTask =
  | { kind: 'github'; id: `gh:${number}`; issueNumber: number; instruction: string; title: string }
  | { kind: 'local'; task: TaskRecord };

/**
 * Pick the next task: GitHub issues first (open + label), then first pending in local queue.
 */
export async function discoverNextTask(
  repoRoot: string,
  cfg: SdlcConfigWithFeatures,
  processingTaskId: string | null,
  blockedIssueNumbers: Set<number>,
): Promise<DiscoveredTask | null> {
  if (processingTaskId) return null;

  if (cfg.taskSources.githubIssues) {
    const session = minimalSession(repoRoot);
    const org = resolveOwnerRepo(session);
    if (org) {
      const issues = listOpenIssues(
        session,
        org.owner,
        org.repo,
        cfg.taskSources.githubIssueLabels,
        cfg.taskSources.githubIssueLimit,
      );
      for (const is of issues) {
        if (blockedIssueNumbers.has(is.number)) continue;
        const id = `gh:${is.number}` as const;
        const instruction = [is.title, is.body?.trim() ? `\n\n${is.body.trim()}` : '']
          .join('')
          .trim()
          .slice(0, 12000);
        if (instruction) {
          return { kind: 'github', id, issueNumber: is.number, instruction, title: is.title };
        }
      }
    }
  }

  if (cfg.taskSources.localQueue) {
    const qPath = path.join(repoRoot, cfg.taskSources.localQueueFile);
    const q = await loadQueueFile(qPath);
    const pending = q.tasks.find(t => t.status === 'pending');
    if (pending) return { kind: 'local', task: pending };
  }

  return null;
}
