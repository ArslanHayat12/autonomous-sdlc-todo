import { execGit } from '../git-exec.js';

export type CommitBody = {
  why: string;
  what: string;
  components: string[];
  architecture: string;
  security: string;
  tests: string;
  breaking: string;
};

export class CommitMessageGenerator {
  generateTitle(scope: string, summary: string): string {
    const s = summary.replace(/\s+/g, ' ').trim().slice(0, 72);
    return `feat(${scope}): ${s || 'SDLC automated change'}`;
  }

  generateBody(b: CommitBody): string {
    return [
      b.why && `Why: ${b.why}`,
      b.what && `What: ${b.what}`,
      b.components.length && `Components: ${b.components.join(', ')}`,
      b.architecture && `Architecture: ${b.architecture}`,
      b.security && `Security: ${b.security}`,
      b.tests && `Tests & validation: ${b.tests}`,
      b.breaking && `Breaking: ${b.breaking}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  describeDiff(repoRoot: string): { stat: string; files: string[] } {
    const stat = execGit(repoRoot, ['diff', '--stat', 'HEAD~', 'HEAD'], true).trim();
    if (stat.startsWith('__GIT_FAIL__')) {
      const st = execGit(repoRoot, ['diff', '--cached', '--stat'], true);
      const files = execGit(repoRoot, ['diff', '--cached', '--name-only'], true)
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);
      return { stat: st, files };
    }
    const files = execGit(repoRoot, ['diff', '--name-only', 'HEAD~', 'HEAD'], true)
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);
    return { stat, files };
  }
}
