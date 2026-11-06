import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { execGit } from './git-exec.js';

export type WorktreeSession = {
  /** Real filesystem path of the isolated clone (linked worktree) */
  path: string;
  /** New branch name created at the worktree (contains /) */
  branch: string;
  /** Opaque main repo root (user's checkout; may stay dirty) */
  mainRepoRoot: string;
  /** Git ref used as the base of the new branch (commit SHA) */
  baseSha: string;
};

function trim(s: string): string {
  return s.trim();
}

/**
 * Resolve the commit SHA for the SDLC **base** branch (e.g. `main`).
 *
 * **Prefer `origin/<baseBranch>`** after `fetch` so feature branches match GitHub’s default
 * branch — using only local `refs/heads/main` can leave you behind `origin/main` and produce PRs
 * GitHub reports as “not mergeable” until manually updated.
 */
export function resolveMainBaseSha(mainRepoRoot: string, baseBranch = 'main'): string {
  execGit(mainRepoRoot, ['fetch', 'origin'], true);
  /** Remote tracking first, then local branch, then legacy main/master fallbacks. */
  const candidates = [
    `refs/remotes/origin/${baseBranch}`,
    `refs/heads/${baseBranch}`,
    'refs/remotes/origin/main',
    'refs/remotes/origin/master',
    'refs/heads/main',
    'refs/heads/master',
    'main',
    'master',
  ];
  for (const ref of candidates) {
    const out = trim(execGit(mainRepoRoot, ['rev-parse', ref], true));
    if (!out.startsWith('__GIT_FAIL__') && /^[0-9a-f]{7,40}$/i.test(out)) return out;
  }
  const sym = trim(execGit(mainRepoRoot, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], true));
  if (!sym.startsWith('__GIT_FAIL__') && sym) {
    const out = trim(execGit(mainRepoRoot, ['rev-parse', sym], true));
    if (!out.startsWith('__GIT_FAIL__') && /^[0-9a-f]{7,40}$/i.test(out)) return out;
  }
  const head = trim(execGit(mainRepoRoot, ['rev-parse', 'HEAD'], true));
  if (head.startsWith('__GIT_FAIL__') || !/^[0-9a-f]{7,40}$/i.test(head)) {
    throw new Error(
      'Could not resolve latest main-branch commit. Add a remote with main/master or work on a clone with an initialized main branch.',
    );
  }
  return head;
}

export type WorktreeOptions = {
  branchPrefix?: string;
  worktreesDirectory?: string;
};

/**
 * Creates a linked worktree with a new branch from `baseSha`. Does not read or modify
 * the main working tree's index or files.
 */
export async function createIsolatedWorktree(
  mainRepoRoot: string,
  baseSha: string,
  options: WorktreeOptions = {},
): Promise<WorktreeSession> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const prefix = options.branchPrefix ?? 'sdlc/agent-';
  const branch = `${prefix}${stamp}`;
  const parent = path.join(mainRepoRoot, options.worktreesDirectory ?? '.sdlc-worktrees');
  await mkdir(parent, { recursive: true });
  const wtPath = path.join(parent, branch.replace(/\//g, '__'));

  await rm(wtPath, { recursive: true, force: true }).catch(() => {});
  execGit(mainRepoRoot, ['worktree', 'add', '-b', branch, wtPath, baseSha]);

  return { path: wtPath, branch, mainRepoRoot, baseSha };
}

/**
 * Create feature branch in the main clone (no extra worktree). Requires a **clean** working tree.
 * @see sdlc.features.json `isolatedWorktree: false`
 */
export function createFeatureBranchInPlace(
  mainRepoRoot: string,
  baseSha: string,
  options: WorktreeOptions = {},
): WorktreeSession {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const prefix = options.branchPrefix ?? 'sdlc/agent-';
  const branch = `${prefix}${stamp}`;
  const dirty = trim(execGit(mainRepoRoot, ['status', '--porcelain'], true));
  if (dirty && !dirty.startsWith('__GIT_FAIL__')) {
    throw new Error(
      'Working tree is not clean. Set "isolatedWorktree": true in sdlc.features.json (default), or commit/stash before in-place mode.',
    );
  }
  execGit(mainRepoRoot, ['switch', '-c', branch, baseSha]);
  return { path: mainRepoRoot, branch, mainRepoRoot, baseSha };
}

/** Restore previous branch and delete the feature branch after an in-place run. */
export function removeInPlaceSession(session: WorktreeSession, restoreBranch: string): void {
  if (session.path !== session.mainRepoRoot) return;
  execGit(session.mainRepoRoot, ['switch', restoreBranch], true);
  execGit(session.mainRepoRoot, ['branch', '-D', session.branch], true);
}

export async function removeWorktree(session: WorktreeSession): Promise<void> {
  const keep = process.env.SDLC_KEEP_WORKTREE === '1' || process.env.SDLC_KEEP_WORKTREE === 'true';
  if (keep) return;
  try {
    execGit(session.mainRepoRoot, ['worktree', 'remove', '--force', session.path]);
  } catch {
    await rm(session.path, { recursive: true, force: true }).catch(() => {});
  }
  try {
    execGit(session.mainRepoRoot, ['worktree', 'prune']);
  } catch {
    /* ignore */
  }
  try {
    execGit(session.mainRepoRoot, ['branch', '-D', session.branch]);
  } catch {
    /* branch may be merged or in use */
  }
}
