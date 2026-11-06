import { execCmd } from '../git-exec.js';
import type { WorktreeSession } from '../worktree.js';
import type { SdlcConfig } from '../../sdlc.config.js';
import type { GateResult } from './types.js';

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function prState(
  session: WorktreeSession,
  owner: string,
  repo: string,
  prNumber: number,
): string {
  const s = execCmd(
    session.path,
    'gh',
    ['pr', 'view', String(prNumber), '--repo', `${owner}/${repo}`, '--json', 'state', '-q', '.state'],
    true,
  ).trim();
  if (s.startsWith('__CMD_FAIL__')) return 'UNKNOWN';
  return s;
}

export class MergeManager {
  constructor(private readonly cfg: SdlcConfig) {}

  canAutoMerge(gates: GateResult[], hasCriticalReview: boolean): { ok: boolean; reason: string } {
    const mandatoryBad = gates.filter(g => g.mandatory && g.status !== 'passed');
    if (mandatoryBad.length) {
      return {
        ok: false,
        reason: `Mandatory gates not all passed: ${mandatoryBad.map(g => `${g.id}:${g.status}`).join(', ')}.`,
      };
    }
    if (hasCriticalReview) {
      return { ok: false, reason: 'Unresolved critical/high AI review findings.' };
    }
    return { ok: true, reason: 'Local policy OK; GitHub branch protection still applies.' };
  }

  /**
   * Queue merge (`--auto`) when checks block immediate merge; poll until MERGED or timeout.
   * Never uses `--admin` — required reviews / CI must pass on GitHub.
   */
  async mergePr(session: WorktreeSession, owner: string, repo: string, prNumber: number): Promise<{ ok: boolean; message: string }> {
    const strategyFlag =
      this.cfg.git.mergeStrategy === 'squash' ? '--squash' : this.cfg.git.mergeStrategy === 'rebase' ? '--rebase' : '--merge';

    const baseMerge = [String(prNumber), '--repo', `${owner}/${repo}`, strategyFlag];
    if (this.cfg.git.cleanupFeatureBranchAfterMerge) baseMerge.push('--delete-branch');

    const withAuto = execCmd(session.path, 'gh', ['pr', 'merge', ...baseMerge, '--auto'], true);
    let queued = !withAuto.startsWith('__CMD_FAIL__');

    if (!queued) {
      const direct = execCmd(session.path, 'gh', ['pr', 'merge', ...baseMerge], true);
      if (direct.startsWith('__CMD_FAIL__')) {
        return {
          ok: false,
          message: `gh pr merge failed (may need CI/reviews): ${direct.slice(0, 1200)}`,
        };
      }
    }

    const waitMs = Math.min(Math.max(Number(process.env.SDLC_MERGE_WAIT_MS ?? 600_000), 10_000), 3_600_000);
    const pollMs = 5000;
    const deadline = Date.now() + waitMs;

    while (Date.now() < deadline) {
      const state = prState(session, owner, repo, prNumber);
      if (state === 'MERGED') {
        return { ok: true, message: queued ? 'Merge completed (--auto queue or fast merge).' : 'Merged immediately.' };
      }
      if (state === 'CLOSED') {
        return { ok: false, message: 'PR closed without merge.' };
      }
      await sleep(pollMs);
    }

    const finalState = prState(session, owner, repo, prNumber);
    return {
      ok: false,
      message: `PR still ${finalState} after ${waitMs}ms. On GitHub: complete required checks/approvals, or merge manually. Last gh output: ${(queued ? withAuto : 'direct').slice(0, 400)}`,
    };
  }
}
