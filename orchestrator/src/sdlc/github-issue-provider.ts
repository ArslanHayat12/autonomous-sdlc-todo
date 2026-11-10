import { execCmd } from '../git-exec.js';
import type { WorktreeSession } from '../worktree.js';
import { resolveGitHubRepo } from '../gh-pr.js';

export type GhIssueRow = { number: number; title: string; body: string };

/**
 * List open issues with given labels via `gh` CLI (no paid API dependency).
 */
export function listOpenIssues(
  session: WorktreeSession,
  owner: string,
  repo: string,
  labelsCsv: string,
  limit: number,
): GhIssueRow[] {
  const args = [
    'issue',
    'list',
    '--repo',
    `${owner}/${repo}`,
    '--state',
    'open',
    '--limit',
    String(limit),
    '--json',
    'number,title,body',
  ];
  if (labelsCsv.trim()) {
    args.push('--label', labelsCsv);
  }
  const out = execCmd(session.path, 'gh', args, true);
  if (out.startsWith('__CMD_FAIL__')) return [];
  try {
    const rows = JSON.parse(out.trim()) as GhIssueRow[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export function resolveOwnerRepo(session: WorktreeSession): { owner: string; repo: string } | null {
  return resolveGitHubRepo(session);
}

export function closeIssue(session: WorktreeSession, owner: string, repo: string, issueNumber: number, body?: string): void {
  const args = ['issue', 'close', String(issueNumber), '--repo', `${owner}/${repo}`];
  if (body) args.push('--comment', body);
  execCmd(session.path, 'gh', args, true);
}

export function commentOnIssue(
  session: WorktreeSession,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
): void {
  execCmd(session.path, 'gh', ['issue', 'comment', String(issueNumber), '--repo', `${owner}/${repo}`, '--body', body], true);
}
