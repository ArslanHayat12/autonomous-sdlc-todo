import { resolveMainBaseSha, createIsolatedWorktree, removeWorktree, type WorktreeSession } from '../worktree.js';
import type { SdlcConfig } from '../../sdlc.config.js';

/** Git worktree lifecycle for isolated SDLC execution */
export class GitWorktreeManager {
  constructor(private readonly cfg: SdlcConfig) {}

  resolveBaseSha(mainRepoRoot: string): string {
    return resolveMainBaseSha(mainRepoRoot);
  }

  async create(mainRepoRoot: string, baseSha: string): Promise<WorktreeSession> {
    return createIsolatedWorktree(mainRepoRoot, baseSha, {
      branchPrefix: this.cfg.git.featureBranchPrefix,
      worktreesDirectory: this.cfg.git.worktreesDirectory,
    });
  }

  async remove(session: WorktreeSession): Promise<void> {
    await removeWorktree(session);
  }
}

export class BranchManager {
  constructor(private readonly cfg: SdlcConfig) {}

  get baseBranch(): string {
    return this.cfg.git.baseBranch;
  }
}
