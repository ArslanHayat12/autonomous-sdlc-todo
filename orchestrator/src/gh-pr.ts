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

/** Default label colors (6-char hex, no #) for auto-created repo labels */
const defaultLabelMeta: Record<string, { color: string; description: string }> = {
  sdlc: { color: '1D76DB', description: 'Autonomous SDLC orchestrator run' },
  automation: { color: '5319E7', description: 'Automation / bot-opened PR' },
};

/**
 * Create missing labels on the repo so `gh pr create --label` does not fail.
 * Uses `gh label create … --force` (creates or updates). Set SDLC_SKIP_LABEL_ENSURE=1 to skip.
 */
function ensureRepoLabels(cwd: string, owner: string, repo: string, labels: string[]): void {
  if (process.env.SDLC_SKIP_LABEL_ENSURE === '1' || !labels.length) return;
  const full = `${owner}/${repo}`;
  for (const name of labels) {
    const meta = defaultLabelMeta[name] ?? { color: '0E8A16', description: 'SDLC' };
    execCmd(
      cwd,
      'gh',
      ['label', 'create', name, '--repo', full, '--color', meta.color, '--description', meta.description, '--force'],
      true,
    );
  }
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

  let base: string = process.env.GITHUB_BASE_BRANCH?.trim() ?? '';
  if (!base) {
    const b = execCmd(
      session.path,
      'gh',
      ['repo', 'view', `${owner}/${repo}`, '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name'],
      true,
    ).trim();
    base = b.startsWith('__CMD_FAIL__') || !b ? 'main' : b;
  }

  function runPrCreate(labelArgs: string[]): string {
    const bodyFile = writeBodyTemp(body);
    try {
      return execCmd(
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
  }

  const labelArgs = labels.flatMap(l => ['--label', l]);
  ensureRepoLabels(session.path, owner, repo, labels);
  let create = runPrCreate(labelArgs);
  let labelRetryNote = '';

  /** gh fails the whole create if any --label does not exist on the repo; retry without labels. */
  if (create.startsWith('__CMD_FAIL__') && labelArgs.length > 0 && /label/i.test(create)) {
    create = runPrCreate([]);
    if (!create.startsWith('__CMD_FAIL__')) {
      labelRetryNote = `(note: PR opened without labels; create ${labels.map(l => `'${l}'`).join(' and ')} on GitHub or set github.autoLabel false in sdlc.config.ts)`;
    }
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

  const url = create.trim().split(/\r?\n/)[0] ?? create.trim();
  let num = parsePrNumberFromPullUrl(url);
  if (num === null && url.startsWith('http')) {
    const byHead = execCmd(
      session.path,
      'gh',
      ['pr', 'view', '--repo', `${owner}/${repo}`, '--head', session.branch, '--json', 'number', '-q', '.number'],
      true,
    ).trim();
    num = parsePrNumber(byHead.startsWith('__CMD_FAIL__') ? '' : byHead);
  }
  const message = [url, labelRetryNote].filter(Boolean).join('\n');
  return { prUrl: url.startsWith('http') ? url : null, message, prNumber: num };
}

function parsePrNumber(s: string): number | null {
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

/** `gh pr create` prints a URL; `gh pr view --head` fails for branch names containing `/` (e.g. `feature/foo`). */
function parsePrNumberFromPullUrl(url: string): number | null {
  const m = url.trim().match(/\/(?:pull|pull-requests)\/(\d+)/);
  return m ? parsePrNumber(m[1]) : null;
}

export function getPullRequestHeadSha(
  session: WorktreeSession,
  owner: string,
  repo: string,
  prNumber: number,
): string | null {
  if (!ghAvailable()) return null;
  const out = execCmd(
    session.path,
    'gh',
    ['pr', 'view', String(prNumber), '--repo', `${owner}/${repo}`, '--json', 'headRefOid', '-q', '.headRefOid'],
    true,
  ).trim();
  if (out.startsWith('__CMD_FAIL__') || !out) return null;
  return out;
}

/** First added line in a unified diff hunk (for inline review comments). */
export function firstAddedLineInPatch(patch: string): number | null {
  let newLine = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      const m = line.match(/\+(\d+)/);
      if (m) newLine = Number.parseInt(m[1], 10) - 1;
      continue;
    }
    if (line.startsWith('+++')) continue;
    if (line.startsWith('+')) {
      newLine++;
      return newLine;
    }
    if (line.startsWith(' ')) newLine++;
  }
  return null;
}

type PrFileEntry = { filename: string; patch?: string };

function listPullRequestFiles(
  session: WorktreeSession,
  owner: string,
  repo: string,
  prNumber: number,
): PrFileEntry[] {
  const out = execCmd(
    session.path,
    'gh',
    ['api', `repos/${owner}/${repo}/pulls/${prNumber}/files`, '--paginate'],
    true,
  );
  if (out.startsWith('__CMD_FAIL__')) return [];
  try {
    const data = JSON.parse(out) as unknown;
    if (!Array.isArray(data)) return [];
    const entries: PrFileEntry[] = [];
    for (const f of data) {
      if (typeof f !== 'object' || f === null) continue;
      const o = f as Record<string, unknown>;
      if (typeof o.filename !== 'string') continue;
      entries.push({
        filename: o.filename,
        patch: typeof o.patch === 'string' ? o.patch : undefined,
      });
    }
    return entries;
  } catch {
    return [];
  }
}

export function postPullRequestInlineComment(
  session: WorktreeSession,
  owner: string,
  repo: string,
  prNumber: number,
  input: { path: string; body: string; commitId: string },
): boolean {
  if (!ghAvailable()) return false;
  const normalized = input.path.replace(/^\//, '');
  const files = listPullRequestFiles(session, owner, repo, prNumber);
  const file = files.find(f => f.filename === normalized || f.filename.endsWith(`/${normalized}`));
  if (!file?.patch) return false;
  const line = firstAddedLineInPatch(file.patch);
  if (line === null) return false;

  const out = execCmd(
    session.path,
    'gh',
    [
      'api',
      `repos/${owner}/${repo}/pulls/${prNumber}/comments`,
      '-f',
      `body=${input.body}`,
      '-f',
      `commit_id=${input.commitId}`,
      '-f',
      `path=${file.filename}`,
      '-F',
      `line=${line}`,
      '-f',
      'side=RIGHT',
    ],
    true,
  );
  return !out.startsWith('__CMD_FAIL__');
}

export function commentOnPullRequest(
  session: WorktreeSession,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): boolean {
  if (!ghAvailable()) return false;
  const out = execCmd(
    session.path,
    'gh',
    ['pr', 'comment', String(prNumber), '--repo', `${owner}/${repo}`, '--body', body],
    true,
  );
  return !out.startsWith('__CMD_FAIL__');
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
