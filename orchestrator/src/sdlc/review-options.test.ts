import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFeatureFlagsJson, applyFeatureFlagsToConfig, type SdlcFeatureFlags } from './feature-flags.js';
import { reviewAutoFixEnabled, reviewPrCommentsEnabled } from './review-options.js';
import { sdlcConfig } from '../../sdlc.config.js';

test('normalizeFeatureFlagsJson reads ai.reviewAutoFix and reviewPrComments', () => {
  const flags = normalizeFeatureFlagsJson({
    ai: { reviewAutoFix: false, reviewPrComments: true },
  });
  assert.equal(flags.aiReviewAutoFix, false);
  assert.equal(flags.aiReviewPrComments, true);
});

test('reviewAutoFixEnabled respects feature flag and env skip', () => {
  const flags: SdlcFeatureFlags = {
    ...applyFeatureFlagsToConfig(sdlcConfig, {} as SdlcFeatureFlags).features,
    aiReview: true,
    aiReviewAutoFix: true,
  };
  const cfg = applyFeatureFlagsToConfig(sdlcConfig, flags);
  assert.equal(reviewAutoFixEnabled(cfg), true);
  const prev = process.env.SDLC_SKIP_REVIEW_AUTO_FIX;
  process.env.SDLC_SKIP_REVIEW_AUTO_FIX = '1';
  assert.equal(reviewAutoFixEnabled(cfg), false);
  if (prev === undefined) delete process.env.SDLC_SKIP_REVIEW_AUTO_FIX;
  else process.env.SDLC_SKIP_REVIEW_AUTO_FIX = prev;
});

test('reviewPrCommentsEnabled follows ai.reviewPrComments', () => {
  const flags: SdlcFeatureFlags = {
    ...applyFeatureFlagsToConfig(sdlcConfig, {} as SdlcFeatureFlags).features,
    aiReview: true,
    aiReviewPrComments: false,
  };
  const merged = applyFeatureFlagsToConfig(sdlcConfig, flags);
  assert.equal(merged.github.prReviewComments, false);
  assert.equal(reviewPrCommentsEnabled(merged), false);
});
