import OpenAI from 'openai';
import { execGit } from '../git-exec.js';
import { applyPatches, readTextFileSafe, extractJsonObject } from '../patch.js';
import { parseReviewJson } from '../review-json.js';
import type { PromptBudget } from './prompt-budget.js';
import { truncateForPrompt } from './prompt-budget.js';

export class CodeReviewOrchestrator {
  constructor(
    private client: OpenAI,
    private model: string,
    private budget: PromptBudget,
  ) {}

  async runIteration(
    instruction: string,
    skillsBlock: string,
    session: { path: string; baseSha?: string },
    paths: string[],
  ): Promise<ReturnType<typeof parseReviewJson>> {
    const diffStat = execGit(session.path, ['diff', '--stat', 'HEAD']).trim();
    const parts: string[] = [];
    const base = session.baseSha?.trim();
    for (const p of paths) {
      let block: string | null = null;
      if (this.budget.reviewPreferGitDiff && base) {
        const diff = execGit(session.path, ['diff', `${base}...HEAD`, '--', p], true).trim();
        if (!diff.startsWith('__GIT_FAIL__') && diff) {
          block = `--- diff ${p} (${base}...HEAD) ---\n${truncateForPrompt(diff, this.budget.maxCharsPerFile, 'diff')}`;
        }
      }
      if (!block) {
        const text = await readTextFileSafe(session.path, p, this.budget.maxCharsPerFile);
        if (text === null) continue;
        block = `--- ${p} ---\n${text}`;
      }
      parts.push(block);
    }
    const system = `Strict reviewer. Output ONLY JSON:
{"findings":[{"severity":"critical|high|medium|low","file":"path","issue":"...","fix":"..."}],"needsMoreChanges":true|false,"patches":[{"path":"rel","content":"..."}]}
Critical/high must block merge unless fixed.
If you emit patches: they MUST be complete valid file contents, only for paths you were shown, and MUST keep \`npm run build\` passing (strict TypeScript). Prefer findings without patches when unsure.

## Skills context
${skillsBlock}`;

    const user = `${system}\n\nInstruction:\n${instruction}\n\nDiff stat:\n${diffStat}\n\nFiles:\n${parts.join('\n\n')}`;
    const r = await this.client.responses.create({ model: this.model, input: user });
    const text = r.output_text ?? '';
    return parseReviewJson(text, extractJsonObject);
  }

  hasBlockingFindings(review: ReturnType<typeof parseReviewJson>): boolean {
    return review.findings.some(f => f.severity === 'critical' || f.severity === 'high');
  }

  async applyFixes(session: { path: string }, patches: { path: string; content: string }[]): Promise<void> {
    await applyPatches(
      session.path,
      patches.map(p => ({ path: p.path, content: p.content })),
    );
  }
}
