import test from 'node:test';
import assert from 'node:assert/strict';
import { mandatoryGateFailureMessage, mandatoryGatesFailed } from './mandatory-gates.js';
import type { GateResult } from './types.js';
import type { QualityGateId } from '../../sdlc.config.js';

const gate = (id: QualityGateId, status: GateResult['status'], mandatory: boolean): GateResult => ({
  id,
  status,
  durationMs: 1,
  output: '',
  mandatory,
});

test('mandatoryGatesFailed is true only when a mandatory gate failed', () => {
  assert.equal(mandatoryGatesFailed([gate('e2e', 'passed', true)]), false);
  assert.equal(mandatoryGatesFailed([gate('e2e', 'skipped', true)]), false);
  assert.equal(mandatoryGatesFailed([gate('e2e', 'failed', true)]), true);
  assert.equal(mandatoryGatesFailed([gate('e2e', 'failed', false)]), false);
});

test('mandatoryGateFailureMessage lists failed mandatory gates', () => {
  const msg = mandatoryGateFailureMessage([gate('e2e', 'failed', true)]);
  assert.match(msg, /e2e/);
  assert.match(msg, /Commit blocked/);
});
