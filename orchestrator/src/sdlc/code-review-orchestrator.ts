import OpenAI from 'openai';
import { execGit } from '../git-exec.js';
import { applyPatches, readTextFileSafe, extractJsonObject } from '../patch.js';
import { parseReviewJson } from '../review-json.js';
export class CodeReviewOrchestrator {
  constructor(
    private client: OpenAI,
    private model: string,
  ) {}

  async runIteration(
    instruction: string,
    skillsBlock: string,
    session: { path: string },
    paths: string[],
  ): Promise<ReturnType<typeof parseReviewJson>> {
    const diffStat = execGit(session.path, ['diff', '--stat', 'HEAD']).trim();
    const parts: string[] = [];
    for (const p of paths) {
      const text = await readTextFileSafe(session.path, p);
      if (text === null) continue;
      parts.push(`--- ${p} ---\n${text}`);
    }
    const system = `Strict reviewer. Output ONLY JSON:
{"findings":[{"severity":"critical|high|medium|low","file":"path","issue":"...","fix":"..."}],"needsMoreChanges":true|false,"patches":[{"path":"rel","content":"..."}]}
Critical/high must block merge unless fixed.

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
