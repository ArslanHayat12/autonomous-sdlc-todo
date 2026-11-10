import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGitHubRepoFromUrl, resolveGitHubRepo } from './gh-pr.js';
import type { WorktreeSession } from './worktree.js';

test('parseGitHubRepoFromUrl parses https origin', () => {
  assert.deepEqual(parseGitHubRepoFromUrl('https://github.com/ArslanHayat12/autonomous-sdlc-todo.git'), {
    owner: 'ArslanHayat12',
    repo: 'autonomous-sdlc-todo',
  });
});

test('resolveGitHubRepo uses origin when GITHUB_OWNER is blank', () => {
  const prevOwner = process.env.GITHUB_OWNER;
  const prevRepo = process.env.GITHUB_REPO;
  process.env.GITHUB_OWNER = '';
  process.env.GITHUB_REPO = '';
  const session: WorktreeSession = {
    path: process.cwd(),
    branch: 'feat/test',
    mainRepoRoot: process.cwd(),
    baseSha: 'abc',
  };
  const ids = resolveGitHubRepo(session);
  assert.ok(ids?.owner && ids?.repo, 'expected owner/repo from this repo origin');
  if (prevOwner === undefined) delete process.env.GITHUB_OWNER;
  else process.env.GITHUB_OWNER = prevOwner;
  if (prevRepo === undefined) delete process.env.GITHUB_REPO;
  else process.env.GITHUB_REPO = prevRepo;
});
