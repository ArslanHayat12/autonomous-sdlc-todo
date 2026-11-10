import { execGit } from '../git-exec.js';
import type { WorktreeSession } from '../worktree.js';

export type CommitSkillRole = 'implementation' | 'review-fix' | 'publish' | 'other';

export type PrCommitSkillRecord = {
  sha: string;
  shortSha: string;
  subject: string;
  role: CommitSkillRole;
  skillIds: string[];
};

export function headCommitSha(session: WorktreeSession): string {
  return execGit(session.path, ['rev-parse', 'HEAD']).trim();
}

export function appendCommitSkillRecord(
  log: PrCommitSkillRecord[],
  session: WorktreeSession,
  subject: string,
  role: CommitSkillRole,
  skillIds: string[],
): void {
  const sha = headCommitSha(session);
  log.push({
    sha,
    shortSha: sha.slice(0, 7),
    subject: subject.replace(/\s+/g, ' ').trim().slice(0, 120),
    role,
    skillIds: [...skillIds],
  });
}

export function listBranchCommitsSinceBase(
  session: WorktreeSession,
  baseSha: string,
): { sha: string; subject: string }[] {
  const out = execGit(session.path, ['log', `${baseSha}..HEAD`, '--format=%H%x1f%s', '--reverse']).trim();
  if (!out) return [];
  return out.split('\n').map(line => {
    const tab = line.indexOf('\x1f');
    if (tab < 0) return { sha: line, subject: '' };
    return { sha: line.slice(0, tab), subject: line.slice(tab + 1) };
  });
}

/** Merge SDLC-recorded skill IDs with the full commit list on the PR branch. */
export function mergeCommitSkillRecordsForPr(
  branchCommits: { sha: string; subject: string }[],
  recorded: PrCommitSkillRecord[],
): PrCommitSkillRecord[] {
  const bySha = new Map(recorded.map(r => [r.sha, r]));
  return branchCommits.map(c => {
    const hit = bySha.get(c.sha);
    if (hit) return hit;
    return {
      sha: c.sha,
      shortSha: c.sha.slice(0, 7),
      subject: c.subject.replace(/\s+/g, ' ').trim().slice(0, 120),
      role: 'other' as const,
      skillIds: [],
    };
  });
}

export function resolvePrCommitSkillRecords(
  session: WorktreeSession,
  baseSha: string | undefined,
  recorded: PrCommitSkillRecord[],
): PrCommitSkillRecord[] {
  if (!baseSha) return [...recorded];
  return mergeCommitSkillRecordsForPr(listBranchCommitsSinceBase(session, baseSha), recorded);
}
