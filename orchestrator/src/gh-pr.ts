import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execCmd, execGit } from './git-exec.js';
import type { WorktreeSession } from './worktree.js';

function hasGh(): boolean {
  try {
    execFileSync('gh', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

export function ghAvailable(): boolean {
  return hasGh();
}

export function resolveRemoteUrl(session: WorktreeSession): string | null {
  const out = execGit(session.path, ['remote', 'get-url', 'origin'], true).trim();
  if (out.startsWith('__GIT_FAIL__') || !out) return null;
  return out;
}

function writeBodyTemp(body: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sdlc-gh-'));
  const f = path.join(dir, 'pr-body.md');
  writeFileSync(f, body, 'utf8');
  return f;
}

function unlinkBodyTemp(file: string): void {
  try {
    unlinkSync(file);
    unlinkSync(path.dirname(file));
  } catch {
    /* ignore */
  }
}

export function parseGitHubRepoFromUrl(url: string): { owner: string; repo: string } | null {
  const ssh = url.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  const https = url.match(/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?(?:\/|$)/i);
  if (https) return { owner: https[1], repo: https[2] };
  return null;
}

export async function pushAndOpenPr(
  session: WorktreeSession,
  title: string,
  body: string,
  labels: string[] = [],
): Promise<{ prUrl: string | null; message: string; prNumber: number | null }> {
  const envOwner = process.env.GITHUB_OWNER;
  const envRepo = process.env.GITHUB_REPO;
  const remote = resolveRemoteUrl(session);
  const parsed = remote ? parseGitHubRepoFromUrl(remote) : null;
  const owner = envOwner ?? parsed?.owner;
  const repo = envRepo ?? parsed?.repo;

  try {
    execGit(session.path, ['push', '-u', 'origin', session.branch]);
  } catch (e) {
    return {
      prUrl: null,
      message: `Push failed (set remote / auth): ${e instanceof Error ? e.message : String(e)}`,
      prNumber: null,
    };
  }

  if (!ghAvailable()) {
    return {
      prUrl: null,
      message:
        'gh CLI not found. Branch was pushed if the remote accepted it. Install gh (`brew install gh`) and run `gh auth login` for automatic PR creation.',
      prNumber: null,
    };
  }

  if (!owner || !repo) {
    return {
      prUrl: null,
      message: 'Set GITHUB_OWNER and GITHUB_REPO or use a github.com origin URL so gh can open a PR.',
      prNumber: null,
    };
  }

  let base = process.env.GITHUB_BASE_BRANCH?.trim();
  if (!base) {
    const b = execCmd(
      session.path,
      'gh',
      ['repo', 'view', `${owner}/${repo}`, '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name'],
      true,
    ).trim();
    base = b.startsWith('__CMD_FAIL__') || !b ? 'main' : b;
  }

  const labelArgs = labels.flatMap(l => ['--label', l]);
  const bodyFile = writeBodyTemp(body);
  let create: string;
  try {
    create = execCmd(
      session.path,
      'gh',
      [
        'pr',
        'create',
        '--repo',
        `${owner}/${repo}`,
        '--base',
        base,
        '--head',
        session.branch,
        '--title',
        title,
        '--body-file',
        bodyFile,
        ...labelArgs,
      ],
      true,
    );
  } finally {
    unlinkBodyTemp(bodyFile);
  }

  if (create.startsWith('__CMD_FAIL__')) {
    const view = execCmd(session.path, 'gh', ['pr', 'view', '--repo', `${owner}/${repo}`, '--json', 'url', '-q', '.url'], true).trim();
    if (!view.startsWith('__CMD_FAIL__') && view.startsWith('http')) {
      const num = parsePrNumber(
        execCmd(session.path, 'gh', ['pr', 'view', '--repo', `${owner}/${repo}`, '--json', 'number', '-q', '.number'], true).trim(),
      );
      return { prUrl: view, message: 'PR already exists; returning existing URL.', prNumber: num };
    }
    return { prUrl: null, message: create, prNumber: null };
  }

  const url = create.trim();
  const num = parsePrNumber(
    execCmd(session.path, 'gh', ['pr', 'view', '--repo', `${owner}/${repo}`, '--head', session.branch, '--json', 'number', '-q', '.number'], true).trim(),
  );
  return { prUrl: url.startsWith('http') ? url : null, message: url, prNumber: num };
}

function parsePrNumber(s: string): number | null {
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

export async function updatePrDescription(session: WorktreeSession, body: string): Promise<string | null> {
  if (!ghAvailable()) return null;
  const remote = resolveRemoteUrl(session);
  const parsed = remote ? parseGitHubRepoFromUrl(remote) : null;
  const owner = process.env.GITHUB_OWNER ?? parsed?.owner;
  const repo = process.env.GITHUB_REPO ?? parsed?.repo;
  if (!owner || !repo) return null;
  const bodyFile = writeBodyTemp(body);
  let out: string;
  try {
    out = execCmd(session.path, 'gh', ['pr', 'edit', '--repo', `${owner}/${repo}`, '--body-file', bodyFile], true);
  } finally {
    unlinkBodyTemp(bodyFile);
  }
  if (out.startsWith('__CMD_FAIL__')) return null;
  const url = execCmd(session.path, 'gh', ['pr', 'view', '--repo', `${owner}/${repo}`, '--json', 'url', '-q', '.url'], true).trim();
  return url.startsWith('http') ? url : null;
}
