import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ExecutionReport } from './types.js';

export class ReportGenerator {
  async writeMarkdown(repoRoot: string, reportDirRel: string, report: ExecutionReport): Promise<string> {
    const dir = path.join(repoRoot, reportDirRel);
    await mkdir(dir, { recursive: true });
    const name = `report-${report.commitSha.slice(0, 7)}-${Date.now()}.md`;
    const p = path.join(dir, name);
    const md = this.format(report);
    await writeFile(p, md, 'utf8');
    return p;
  }

  format(r: ExecutionReport): string {
    return [
      `# SDLC execution report`,
      ``,
      `## Summary`,
      `- Original branch: \`${r.originalBranch}\``,
      `- Feature branch: \`${r.featureBranch}\``,
      `- Base SHA: \`${r.baseSha}\``,
      `- Commit: \`${r.commitSha}\``,
      `- PR: ${r.prUrl ?? 'n/a'}`,
      ``,
      `## Selected skills`,
      r.selectedSkills.length ? r.selectedSkills.map(s => `- ${s}`).join('\n') : '- (none)',
      ``,
      `## Skill invocations`,
      r.skillInvocations.map(i => `- **${i.skillId}** (${i.ran ? 'ran' : 'not run'}): ${i.mechanism} — ${i.evidence}`).join('\n') || '- none',
      ``,
      `## Implementation`,
      r.implementationSummary,
      ``,
      `## Files changed`,
      r.filesChanged.map(f => `- \`${f}\``).join('\n') || '- none',
      ``,
      `## Commit message`,
      '```',
      r.commitMessage,
      '```',
      ``,
      `## Review`,
      r.reviewFindings || '- none',
      ``,
      `## Quality gates`,
      r.gateResults
        .map(
          g =>
            `- **${g.id}**: ${g.status} (${g.mandatory ? 'mandatory' : 'optional'}) ${g.durationMs}ms`,
        )
        .join('\n'),
      ``,
      `## Merge`,
      r.mergeStatus,
      ``,
      `## Docker`,
      `- Image tag: ${r.dockerImageTag ?? 'n/a'}`,
      `- Deployment: ${r.deploymentStatus}`,
      `- Health: ${r.healthResults.map(h => `${h.name}:${h.ok ? 'ok' : 'fail'}`).join(', ')}`,
      r.rollbackStatus ? `- Rollback: ${r.rollbackStatus}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
}
