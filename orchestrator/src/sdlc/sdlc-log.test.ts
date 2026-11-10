import test from 'node:test';
import assert from 'node:assert/strict';
import { formatStepBullet, stripAnsi } from './sdlc-log.js';

test('formatStepBullet uses bullets without ANSI when SDLC_NO_COLOR=1', () => {
  const prev = process.env.SDLC_NO_COLOR;
  process.env.SDLC_NO_COLOR = '1';
  const { plain, line } = formatStepBullet('git branch', 'feat/foo-bar-abc123');
  assert.match(plain, /git branch: feat/);
  assert.match(line, /^  • git branch —/);
  assert.doesNotMatch(line, /\x1b/);
  if (prev === undefined) delete process.env.SDLC_NO_COLOR;
  else process.env.SDLC_NO_COLOR = prev;
});

test('stripAnsi removes escape codes', () => {
  assert.equal(stripAnsi('\x1b[32mgreen\x1b[0m'), 'green');
});
