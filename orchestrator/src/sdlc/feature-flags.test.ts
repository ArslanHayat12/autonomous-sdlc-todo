import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFeatureFlagsJson } from './feature-flags.js';

test('normalizeFeatureFlagsJson reads nested groups', () => {
  const flags = normalizeFeatureFlagsJson({
    meta: { version: 1 },
    ai: { heroSkills: true, review: false, autoImplement: true },
    quality: { gatesInWorktree: false, verifyMainBeforeRun: true, mainVerificationCommand: 'npm test' },
    delivery: { autoMerge: false },
  });
  assert.equal(flags.aiHeroSkills, true);
  assert.equal(flags.aiReview, false);
  assert.equal(flags.qualityGates, false);
  assert.equal(flags.runMainRepoVerificationBeforeSdlc, true);
  assert.equal(flags.mainRepoVerificationCommand, 'npm test');
  assert.equal(flags.autoMerge, false);
});

test('normalizeFeatureFlagsJson accepts legacy flat file', () => {
  const flags = normalizeFeatureFlagsJson({
    aiReview: true,
    qualityGates: true,
  });
  assert.equal(flags.aiReview, true);
  assert.equal(flags.qualityGates, true);
});
