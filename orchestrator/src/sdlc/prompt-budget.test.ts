import test from 'node:test';
import assert from 'node:assert/strict';
import { sdlcConfig } from '../../sdlc.config.js';
import { resolvePromptBudget, truncateForPrompt } from './prompt-budget.js';

test('resolvePromptBudget uses compact limits when compactPrompts is true', () => {
  const b = resolvePromptBudget(sdlcConfig.ai, true);
  assert.ok(b.maxCharsPerFile <= 12_000);
  assert.ok(b.maxSkillsInPrompt <= 3);
  assert.equal(b.reviewPreferGitDiff, true);
});

test('resolvePromptBudget honors SDLC_MAX_CHARS_PER_FILE', () => {
  const prev = process.env.SDLC_MAX_CHARS_PER_FILE;
  process.env.SDLC_MAX_CHARS_PER_FILE = '5000';
  try {
    const b = resolvePromptBudget(sdlcConfig.ai, false);
    assert.equal(b.maxCharsPerFile, 5000);
  } finally {
    if (prev === undefined) delete process.env.SDLC_MAX_CHARS_PER_FILE;
    else process.env.SDLC_MAX_CHARS_PER_FILE = prev;
  }
});

test('truncateForPrompt leaves short text unchanged', () => {
  assert.equal(truncateForPrompt('abc', 10), 'abc');
});
