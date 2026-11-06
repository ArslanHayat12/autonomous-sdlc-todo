import { execCmd } from '../git-exec.js';
import type { WorktreeSession } from '../worktree.js';
import type { SdlcConfig } from '../../sdlc.config.js';
import type { GateResult } from './types.js';

export class MergeManager {
  constructor(private readonly cfg: SdlcConfig) {}

  canAutoMerge(gates: GateResult[], hasCriticalReview: boolean): { ok: boolean; reason: string } {
    const mandatoryBad = gates.filter(
      g => g.mandatory && g.status !== 'passed',
    );
    if (mandatoryBad.length) {
      return {
        ok: false,
        reason: `Mandatory gates not all passed: ${mandatoryBad.map(g => `${g.id}:${g.status}`).join(', ')}. Skipped/failed/error do not satisfy mandatory policy.`,
      };
    }
    if (hasCriticalReview) {
      return { ok: false, reason: 'Unresolved critical/high AI review findings.' };
    }
    return { ok: true, reason: 'Policies satisfied (subject to GitHub branch protection).' };
  }

  mergePr(session: WorktreeSession, owner: string, repo: string, prNumber: number): { ok: boolean; message: string } {
    const strategyFlag =
      this.cfg.git.mergeStrategy === 'squash' ? '--squash' : this.cfg.git.mergeStrategy === 'rebase' ? '--rebase' : '--merge';
    const mergeArgs = ['pr', 'merge', String(prNumber), '--repo', `${owner}/${repo}`, strategyFlag];
    if (this.cfg.git.cleanupFeatureBranchAfterMerge) mergeArgs.push('--delete-branch');
    const out = execCmd(session.path, 'gh', mergeArgs, true);
    if (out.startsWith('__CMD_FAIL__')) {
      return {
        ok: false,
        message: `Merge blocked or failed (branch protection / approvals required): ${out}`,
      };
    }
    return { ok: true, message: out.trim() };
  }
}
