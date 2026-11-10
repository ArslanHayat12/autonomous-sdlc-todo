import type { ReviewFinding } from '../review-json.js';
import type { SdlcConfig } from '../../sdlc.config.js';
import {
  commentOnPullRequest,
  ghAvailable,
  getPullRequestHeadSha,
  postPullRequestInlineComment,
} from '../gh-pr.js';
import type { WorktreeSession } from '../worktree.js';
import { execCmd } from '../git-exec.js';

const SEVERITY_ORDER: ReviewFinding['severity'][] = ['critical', 'high', 'medium', 'low'];

const SEVERITY_META: Record<
  ReviewFinding['severity'],
  { heading: string; blocksMerge: boolean; icon: string }
> = {
  critical: { heading: 'Critical', blocksMerge: true, icon: '🚨' },
  high: { heading: 'High', blocksMerge: true, icon: '⛔' },
  medium: { heading: 'Medium', blocksMerge: false, icon: '⚠️' },
  low: { heading: 'Low', blocksMerge: false, icon: 'ℹ️' },
};

export function reviewPrCommentsEnabled(cfg: SdlcConfig): boolean {
  if (process.env.SDLC_SKIP_PR_REVIEW_COMMENTS === '1') return false;
  if (process.env.SDLC_PR_REVIEW_COMMENTS === '1') return true;
  return cfg.github.prReviewComments !== false;
}

export function formatAiReviewPrComment(
  findings: ReviewFinding[],
  options: { skippedReason?: string; iterationNote?: string } = {},
): string {
  const lines: string[] = ['## AI Hero review (SDLC)', ''];

  if (options.skippedReason) {
    lines.push(options.skippedReason, '');
    lines.push('_No inline file comments — review did not run._');
    return lines.join('\n');
  }

  const blocking = findings.filter(f => f.severity === 'critical' || f.severity === 'high');
  if (blocking.length) {
    lines.push(
      '**Merge policy:** `critical` and `high` findings **block auto-merge** until fixed or waived on GitHub.',
      '',
    );
  } else if (findings.length) {
    lines.push('**Merge policy:** No blocking `critical`/`high` findings in this pass.', '');
  } else {
    lines.push('**Merge policy:** No findings in this pass.', '');
  }

  if (options.iterationNote) {
    lines.push(options.iterationNote, '');
  }

  for (const sev of SEVERITY_ORDER) {
    const bucket = findings.filter(f => f.severity === sev);
    if (!bucket.length) continue;
    const meta = SEVERITY_META[sev];
    const tag = meta.blocksMerge ? '**blocks merge**' : 'informational';
    lines.push(`### ${meta.icon} ${meta.heading} (${tag})`, '');
    for (const f of bucket) {
      lines.push(`- **\`${f.file}\`** — ${f.issue}`);
      if (f.fix.trim()) lines.push(`  - _Suggested fix:_ ${f.fix}`);
    }
    lines.push('');
  }

  if (!findings.length) {
    lines.push('_No issues reported._', '');
  }

  lines.push(
    '_Severity guide: **critical** = security/data-loss/production break; **high** = likely bug or major standards gap; **medium/low** = hygiene and follow-ups._',
  );
  return lines.join('\n');
}

function submitGhReviewVerdict(
  session: WorktreeSession,
  owner: string,
  repo: string,
  prNumber: number,
  blocking: boolean,
): void {
  if (!ghAvailable()) return;
  const body = blocking
    ? '🚫 **Changes requested** — critical/high findings must be addressed before merge (see AI Hero review comment).'
    : '✅ **Review comment** — no blocking critical/high findings in the latest AI Hero pass.';
  const flag = blocking ? '--request-changes' : '--comment';
  execCmd(
    session.path,
    'gh',
    ['pr', 'review', String(prNumber), '--repo', `${owner}/${repo}`, flag, '--body', body],
    true,
  );
}

export async function postAiReviewOnPullRequest(
  cfg: SdlcConfig,
  session: WorktreeSession,
  owner: string,
  repo: string,
  prNumber: number,
  findings: ReviewFinding[],
  options: { skippedReason?: string; postInline?: boolean } = {},
): Promise<void> {
  if (!reviewPrCommentsEnabled(cfg)) return;

  const body = formatAiReviewPrComment(findings, { skippedReason: options.skippedReason });
  commentOnPullRequest(session, owner, repo, prNumber, body);

  if (options.skippedReason || options.postInline === false) {
    return;
  }

  const headSha = getPullRequestHeadSha(session, owner, repo, prNumber);
  if (!headSha) return;

  for (const f of findings) {
    const meta = SEVERITY_META[f.severity];
    const inlineBody = `**[${f.severity.toUpperCase()}${meta.blocksMerge ? ' · blocks merge' : ''}]** ${f.issue}${
      f.fix.trim() ? `\n\n_Suggested fix:_ ${f.fix}` : ''
    }`;
    postPullRequestInlineComment(session, owner, repo, prNumber, {
      path: f.file,
      body: inlineBody,
      commitId: headSha,
    });
  }

  const blocking = findings.some(x => x.severity === 'critical' || x.severity === 'high');
  submitGhReviewVerdict(session, owner, repo, prNumber, blocking);
}
