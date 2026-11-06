import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test, before, after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { execGit } from './git-exec.js';
import { createIsolatedWorktree, removeWorktree, resolveMainBaseSha } from './worktree.js';

const orchestratorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(orchestratorRoot, '..');
const gitTemplate = path.join(orchestratorRoot, 'test-fixtures/minimal-git-template');

describe('resolveMainBaseSha', () => {
  test('uses HEAD when no remote', async () => {
    const dir = await mkdtemp(path.join(repoRoot, '.orch-test-resolve-'));
    const env = { ...process.env, GIT_TEMPLATE_DIR: gitTemplate };
    try {
      execFileSync('git', ['init', '-b', 'main'], { cwd: dir, env, stdio: 'pipe' });
      execGit(dir, ['config', 'user.email', 't@e.com']);
      execGit(dir, ['config', 'user.name', 't']);
      await writeFile(path.join(dir, 'a.txt'), '1\n');
      execGit(dir, ['add', 'a.txt']);
      execGit(dir, ['commit', '-m', 'init', '--no-gpg-sign']);
      const sha = resolveMainBaseSha(dir);
      assert.match(sha, /^[0-9a-f]{7,40}$/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('createIsolatedWorktree + dirty main untouched', () => {
  let dir: string;

  before(async () => {
    const env = { ...process.env, GIT_TEMPLATE_DIR: gitTemplate };
    dir = await mkdtemp(path.join(repoRoot, '.orch-test-wt-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir, env, stdio: 'pipe' });
    execGit(dir, ['config', 'user.email', 'wt@test.dev']);
    execGit(dir, ['config', 'user.name', 'wt']);
    await mkdir(path.join(dir, '.sdlc-worktrees'), { recursive: true });
    await writeFile(path.join(dir, 'f.txt'), 'base\n');
    execGit(dir, ['add', 'f.txt']);
    execGit(dir, ['commit', '-m', 'c1', '--no-gpg-sign']);
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('worktree has clean tree from base while main worktree stays dirty', async () => {
    await writeFile(path.join(dir, 'f.txt'), 'dirty-main\n');

    const base = resolveMainBaseSha(dir);
    const session = await createIsolatedWorktree(dir, base);
    try {
      const mainTxt = await readFile(path.join(dir, 'f.txt'), 'utf8');
      assert.equal(mainTxt.trim(), 'dirty-main');

      const wtTxt = await readFile(path.join(session.path, 'f.txt'), 'utf8');
      assert.equal(wtTxt.trim(), 'base');

      execGit(session.path, ['config', 'user.email', 'wt@test.dev']);
      execGit(session.path, ['config', 'user.name', 'wt']);
      await writeFile(path.join(session.path, 'wt-only.txt'), 'x\n');
      execGit(session.path, ['add', 'wt-only.txt']);
      execGit(session.path, ['commit', '-m', 'wt', '--no-gpg-sign']);

      await assert.rejects(readFile(path.join(dir, 'wt-only.txt'), 'utf8'), /ENOENT/);
    } finally {
      await removeWorktree(session);
    }
  });
});
