import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAiReviewPrComment } from './review-pr-comments.js';
import { firstAddedLineInPatch } from '../gh-pr.js';

test('formatAiReviewPrComment groups findings by severity and marks merge blockers', () => {
  const body = formatAiReviewPrComment([
    { severity: 'medium', file: 'a.ts', issue: 'nit', fix: '' },
    { severity: 'critical', file: 'b.ts', issue: 'auth bypass', fix: 'validate token' },
  ]);
  assert.match(body, /### 🚨 Critical/);
  assert.match(body, /blocks merge/);
  assert.match(body, /`b.ts`/);
  assert.match(body, /auth bypass/);
  assert.match(body, /### ⚠️ Medium/);
  assert.ok(body.indexOf('Critical') < body.indexOf('Medium'));
});

test('formatAiReviewPrComment includes skip reason when review did not run', () => {
  const body = formatAiReviewPrComment([], { skippedReason: 'AI review skipped (no key).' });
  assert.match(body, /AI review skipped/);
  assert.match(body, /No inline file comments/);
});

test('firstAddedLineInPatch returns first added line number in a hunk', () => {
  const patch = `@@ -10,3 +10,4 @@
 ctx
-old
+added
 stay`;
  assert.equal(firstAddedLineInPatch(patch), 11);
});

test('firstAddedLineInPatch handles first-line additions', () => {
  const patch = `@@ -0,0 +1,2 @@
+line one
+line two`;
  assert.equal(firstAddedLineInPatch(patch), 1);
});
