import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFeatureBranchName, inferBranchType, slugifyForBranch } from './feature-branch-name.js';

test('slugifyForBranch produces kebab-case', () => {
  assert.equal(slugifyForBranch('Add Authentication to Todo!'), 'add-authentication-to-todo');
});

test('inferBranchType detects fix vs feat', () => {
  assert.equal(inferBranchType('Fix API 500 on delete'), 'fix');
  assert.equal(inferBranchType('Add dark mode toggle'), 'feat');
  assert.equal(inferBranchType('Refactor web app into modules'), 'refactor');
});

test('buildFeatureBranchName semantic shape', () => {
  const b = buildFeatureBranchName('Add todo filters', { naming: 'semantic' });
  assert.match(b, /^feat\/add-todo-filters-[a-f0-9]{6}$/);
});

test('buildFeatureBranchName publish uses chore', () => {
  const b = buildFeatureBranchName('Agent edits', { naming: 'semantic', publish: true });
  assert.match(b, /^chore\/publish-agent-edits-[a-f0-9]{6}$/);
});

test('buildFeatureBranchName scope', () => {
  const b = buildFeatureBranchName('Add auth', { naming: 'semantic', scope: 'web' });
  assert.match(b, /^feat\/web-add-auth-[a-f0-9]{6}$/);
});
