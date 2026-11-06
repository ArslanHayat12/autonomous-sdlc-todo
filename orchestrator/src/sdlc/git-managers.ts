import {
  resolveMainBaseSha,
  createIsolatedWorktree,
  createFeatureBranchInPlace,
  removeWorktree,
  removeInPlaceSession,
  type WorktreeSession,
} from '../worktree.js';
import type { SdlcConfig } from '../../sdlc.config.js';

/** Git worktree lifecycle for isolated SDLC execution */
export class GitWorktreeManager {
  constructor(private readonly cfg: SdlcConfig) {}

  resolveBaseSha(mainRepoRoot: string): string {
    return resolveMainBaseSha(mainRepoRoot);
  }

  async create(mainRepoRoot: string, baseSha: string): Promise<WorktreeSession> {
    if (this.cfg.git.worktreesEnabled) {
      return createIsolatedWorktree(mainRepoRoot, baseSha, {
        branchPrefix: this.cfg.git.featureBranchPrefix,
        worktreesDirectory: this.cfg.git.worktreesDirectory,
      });
    }
    return createFeatureBranchInPlace(mainRepoRoot, baseSha, {
      branchPrefix: this.cfg.git.featureBranchPrefix,
    });
  }

  async remove(session: WorktreeSession, restoreBranch?: string): Promise<void> {
    if (session.path === session.mainRepoRoot && restoreBranch) {
      removeInPlaceSession(session, restoreBranch);
      return;
    }
    await removeWorktree(session);
  }
}

export class BranchManager {
  constructor(private readonly cfg: SdlcConfig) {}

  get baseBranch(): string {
    return this.cfg.git.baseBranch;
  }
}
