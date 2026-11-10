import type { GateResult, SkillInvocation } from './types.js';
import type { PipelineProgress } from './pipeline-progress.js';
import type { PrCommitSkillRecord } from './commit-skills-log.js';

export type PrBodyInput = {
  instruction: string;
  mode: 'full' | 'publish';
  progress: PipelineProgress;
  selectedSkillIds: string[];
  skillInvocations: SkillInvocation[];
  commitSkillRecords: PrCommitSkillRecord[];
  implementationSummary: string;
  gateResults: GateResult[];
  changedFiles: string[];
  reviewText?: string;
  mergeStatus?: string;
  commitSha?: string;
  featureBranch?: string;
};

function gateLine(g: GateResult): string {
  const icon =
    g.status === 'passed' ? '✅' : g.status === 'skipped' ? '⏭️' : g.status === 'failed' ? '❌' : '⚠️';
  return `- ${icon} **${g.id}**: \`${g.status}\`${g.mandatory ? ' (mandatory)' : ''}`;
}

function heroSkillsSection(selectedSkillIds: string[], invocations: SkillInvocation[]): string {
  const lines: string[] = [
    `## AI Hero skills (this run)`,
    ``,
    `Skills are **selected from** \`skills/<id>/SKILL.md\`, injected into OpenAI plan, implementation review, and (when enabled) the commit message. They are **not** executed inside Cursor’s in-IDE skill runtime.`,
    ``,
  ];

  if (!selectedSkillIds.length) {
    lines.push(`_No Hero skills were selected for this instruction (routing off or no matches)._`);
    return lines.join('\n');
  }

  lines.push(`**Selected for this run:** ${selectedSkillIds.map(id => `\`${id}\``).join(', ')}`);
  lines.push(``);
  lines.push(`| Skill | In prompts | Evidence |`);
  lines.push(`| ----- | ------------ | -------- |`);

  for (const id of selectedSkillIds) {
    const inv = invocations.find(i => i.skillId === id);
    const inPrompts = inv?.ran ? '✅ Plan · review · commit' : '⚠️ Listed but SKILL.md missing';
    const evidence = inv?.evidence?.slice(0, 120) ?? '—';
    lines.push(`| \`${id}\` | ${inPrompts} | ${evidence.replace(/\|/g, '\\|')} |`);
  }

  return lines.join('\n');
}

function roleLabel(role: PrCommitSkillRecord['role']): string {
  switch (role) {
    case 'implementation':
      return 'Implementation (+ commit message when enabled)';
    case 'review-fix':
      return 'Review auto-fix';
    case 'publish':
      return 'Publish (no AI implementation)';
    default:
      return 'Other';
  }
}

function commitSkillsPerCommitSection(records: PrCommitSkillRecord[]): string {
  const lines: string[] = [
    `## AI Hero skills per commit`,
    ``,
    `Each commit on this PR branch and which \`skills/<id>/SKILL.md\` IDs were in the SDLC prompts for that step (plan, implementation, review, or skill-aware commit message).`,
    ``,
  ];

  if (!records.length) {
    lines.push(`_No commits on the feature branch yet (or branch equals base SHA)._`);
    return lines.join('\n');
  }

  lines.push(`| Commit | Subject | Step | Hero skills |`);
  lines.push(`| ------ | ------- | ---- | ----------- |`);

  for (const r of records) {
    const skills =
      r.skillIds.length > 0
        ? r.skillIds.map(id => `\`${id}\``).join(', ')
        : '_none (no Hero routing this run)_';
    const subj = r.subject.replace(/\|/g, '\\|').replace(/`/g, "'");
    lines.push(`| \`${r.shortSha}\` | ${subj} | ${roleLabel(r.role)} | ${skills} |`);
  }

  return lines.join('\n');
}

export function buildSdlcPrBody(input: PrBodyInput): string {
  const gateBlock =
    input.gateResults.length > 0
      ? input.gateResults.map(gateLine).join('\n')
      : '_Quality gates not run (disabled or publish-only)._';

  const parts = [
    `## Pipeline progress`,
    ``,
    `_Updated automatically by \`npm run sdlc\` — each step is checked when it succeeds._`,
    ``,
    input.progress.checklistMarkdown(),
    ``,
    heroSkillsSection(input.selectedSkillIds, input.skillInvocations),
    ``,
    commitSkillsPerCommitSection(input.commitSkillRecords),
    ``,
    `## Business requirement`,
    input.instruction,
    ``,
    `## Implementation summary`,
    input.implementationSummary || '_n/a_',
    ``,
  ];

  if (input.mode === 'publish') {
    parts.push(`## Mode`, `**publish** — committed local working tree; no SDLC AI implementation.`, ``);
  }

  parts.push(
    `## Quality gates`,
    gateBlock,
    ``,
    `_Mandatory gates must show **passed** (not skipped) for auto-merge policy. GitHub branch protection still applies._`,
    ``,
    `## Files changed`,
    input.changedFiles.length ? input.changedFiles.map(f => `- \`${f}\``).join('\n') : '_See diff on this PR._',
  );

  if (input.featureBranch || input.commitSha) {
    parts.push(
      ``,
      `## Git`,
      input.featureBranch ? `- Branch: \`${input.featureBranch}\`` : '',
      input.commitSha ? `- Commit: \`${input.commitSha}\`` : '',
    );
  }

  if (input.reviewText) {
    parts.push(``, `## AI Hero code review`, ``, input.reviewText);
  }

  if (input.mergeStatus) {
    parts.push(``, `## Merge status`, ``, input.mergeStatus);
  }

  return parts.filter(Boolean).join('\n');
}
