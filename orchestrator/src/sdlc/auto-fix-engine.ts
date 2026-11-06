import type { ReviewResult } from '../review-json.js';
import { CodeReviewOrchestrator } from './code-review-orchestrator.js';
import type { WorktreeSession } from '../worktree.js';

export class AutoFixEngine {
  constructor(private readonly reviewer: CodeReviewOrchestrator) {}

  async applyPatchesIfAny(
    session: WorktreeSession,
    review: ReviewResult,
  ): Promise<boolean> {
    if (!review.needsMoreChanges || !review.patches?.length) return false;
    await this.reviewer.applyFixes(session, review.patches);
    return true;
  }
}
