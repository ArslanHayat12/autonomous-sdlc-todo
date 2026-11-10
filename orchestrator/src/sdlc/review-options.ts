import type { SdlcConfigWithFeatures } from './feature-flags.js';

/** AI applies review patches + optional follow-up commits (see pipeline review loop). */
export function reviewAutoFixEnabled(cfg: SdlcConfigWithFeatures): boolean {
  if (process.env.SDLC_SKIP_REVIEW_AUTO_FIX === '1') return false;
  if (process.env.SDLC_REVIEW_AUTO_FIX === '1') return true;
  if (!cfg.features.aiReview) return false;
  return cfg.features.aiReviewAutoFix !== false;
}

/** Post AI Hero review thread + inline PR comments after review. */
export function reviewPrCommentsEnabled(cfg: SdlcConfigWithFeatures): boolean {
  if (process.env.SDLC_SKIP_PR_REVIEW_COMMENTS === '1') return false;
  if (process.env.SDLC_PR_REVIEW_COMMENTS === '1') return true;
  if (!cfg.features.aiReview) return false;
  if (cfg.features.aiReviewPrComments === false) return false;
  return cfg.github.prReviewComments !== false;
}
