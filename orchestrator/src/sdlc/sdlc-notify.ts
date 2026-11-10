import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { commentOnPullRequest } from '../gh-pr.js';
import type { WorktreeSession } from '../worktree.js';
import type { PipelineProgress } from './pipeline-progress.js';

export type LastErrorRecord = {
  version: 1;
  at: string;
  instruction: string;
  message: string;
  failedSteps: { id: string; label: string; detail?: string }[];
  prNumber: number | null;
  prUrl: string | null;
};

export function notifyEnabled(): boolean {
  const e = process.env.SDLC_NOTIFY_ON_ERROR?.trim();
  if (e === '0' || e === 'false') return false;
  return true;
}

export async function writeLastError(
  repoRoot: string,
  record: Omit<LastErrorRecord, 'version' | 'at'>,
): Promise<string> {
  const dir = path.join(repoRoot, '.sdlc');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'last-error.json');
  const full: LastErrorRecord = { version: 1, at: new Date().toISOString(), ...record };
  await writeFile(file, JSON.stringify(full, null, 2), 'utf8');
  return file;
}

export async function notifySdlcFailure(options: {
  repoRoot: string;
  session: WorktreeSession | null;
  owner: string | null;
  repo: string | null;
  prNumber: number | null;
  prUrl: string | null;
  instruction: string;
  error: string;
  progress: PipelineProgress;
}): Promise<void> {
  if (!notifyEnabled()) return;

  const failed = options.progress.failedSteps();
  const errFile = await writeLastError(options.repoRoot, {
    instruction: options.instruction,
    message: options.error,
    failedSteps: failed.map(s => ({ id: s.id, label: s.label, detail: s.detail })),
    prNumber: options.prNumber,
    prUrl: options.prUrl,
  });

  const banner = [
    `## SDLC run failed`,
    ``,
    `**Error:**`,
    '```',
    options.error.slice(0, 3500),
    '```',
    ``,
    `**Failed steps:**`,
    failed.length
      ? failed.map(s => `- ❌ **${s.label}**${s.detail ? ` — ${s.detail}` : ''}`).join('\n')
      : '- (see error above)',
    ``,
    `**Pipeline checklist (current):**`,
    options.progress.checklistMarkdown(),
    ``,
    `_Diagnostics written to \`${path.relative(options.repoRoot, errFile)}\`._`,
  ].join('\n');

  console.error(`\n[SDLC ERROR] ${options.error.slice(0, 500)}`);
  console.error(`  Details: ${errFile}`);
  if (options.prUrl) console.error(`  PR: ${options.prUrl}`);

  if (
    options.session &&
    options.owner &&
    options.repo &&
    options.prNumber !== null &&
    process.env.SDLC_SKIP_PR_ERROR_COMMENT !== '1'
  ) {
    commentOnPullRequest(options.session, options.owner, options.repo, options.prNumber, banner);
  }
}
