import { commentOnPullRequest } from '../gh-pr.js';
import type { WorktreeSession } from '../worktree.js';
import type { SdlcConfig } from '../../sdlc.config.js';
import { buildSdlcPrBody, type PrBodyInput } from './pr-body-builder.js';
import type { PipelineProgress } from './pipeline-progress.js';
import { PullRequestManager } from './pull-request-manager.js';

function prChecklistEnabled(cfg: SdlcConfig): boolean {
  if (process.env.SDLC_SKIP_PR_CHECKLIST === '1') return false;
  return cfg.github.prPipelineChecklist !== false;
}

function stepCommentsEnabled(cfg: SdlcConfig): boolean {
  if (process.env.SDLC_PR_STEP_COMMENTS === '1') return true;
  if (process.env.SDLC_SKIP_PR_STEP_COMMENTS === '1') return false;
  return cfg.github.prStepComments === true;
}

export async function syncSdlcPrBody(
  prMgr: PullRequestManager,
  cfg: SdlcConfig,
  session: WorktreeSession,
  prNumber: number | null,
  input: PrBodyInput,
  stepJustFinished?: string,
): Promise<void> {
  if (prNumber === null || !prChecklistEnabled(cfg)) return;

  const body = buildSdlcPrBody(input);
  await prMgr.updateBody(session, body);

  if (stepJustFinished && stepCommentsEnabled(cfg)) {
    const step = input.progress.getStep(stepJustFinished);
    const ids = prMgr.resolveOwnerRepo(session);
    if (step?.status === 'succeeded' && ids) {
      commentOnPullRequest(
        session,
        ids.owner,
        ids.repo,
        prNumber,
        `✅ **${step.label}**${step.detail ? ` — ${step.detail}` : ''}`,
      );
    }
  }
}
