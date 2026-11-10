import { rm } from 'node:fs/promises';
import path from 'node:path';
import { execGit } from '../git-exec.js';
import type { SdlcConfig } from '../../sdlc.config.js';

/**
 * Removes stale linked worktrees under `.sdlc-worktrees/` and prunes git worktree metadata.
 * Best-effort; ignores failures so a run can still proceed.
 */
export async function pruneStaleSdlcWorktrees(mainRepoRoot: string, cfg: SdlcConfig): Promise<void> {
  if (!cfg.git.pruneStaleWorktreesOnStart) return;
  const wtDir = path.join(mainRepoRoot, cfg.git.worktreesDirectory);
  const wtDirNorm = wtDir.endsWith(path.sep) ? wtDir : `${wtDir}${path.sep}`;
  let list = '';
  try {
    list = execGit(mainRepoRoot, ['worktree', 'list', '--porcelain'], true);
  } catch {
    return;
  }
  const lines = list.split('\n');
  const paths: string[] = [];
  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      const p = line.slice('worktree '.length).trim();
      const isMain = path.resolve(p) === path.resolve(mainRepoRoot);
      if (!isMain && (p.startsWith(wtDirNorm) || p.includes(`${cfg.git.worktreesDirectory}${path.sep}`))) {
        paths.push(p);
      }
    }
  }
  for (const wt of paths) {
    try {
      execGit(mainRepoRoot, ['worktree', 'remove', '--force', wt], true);
    } catch {
      await rm(wt, { recursive: true, force: true }).catch(() => {});
    }
  }
  execGit(mainRepoRoot, ['worktree', 'prune'], true);
}
