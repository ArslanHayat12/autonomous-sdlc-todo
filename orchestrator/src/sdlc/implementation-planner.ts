import OpenAI from 'openai';
import { readFile } from 'node:fs/promises';
import type { HeroSkill } from '../hero-skills.js';

export class ImplementationPlanner {
  constructor(
    private client: OpenAI | null,
    private model: string,
  ) {}

  async plan(instruction: string, skills: HeroSkill[], manifestPath: string): Promise<string> {
    let manifest = '';
    try {
      manifest = await readFile(manifestPath, 'utf8');
    } catch {
      manifest = '(no package.json)';
    }
    const skillList = skills.map(s => s.id).join(', ') || 'none';
    if (!this.client) {
      return [
        `# Plan (offline)`,
        ``,
        `- Instruction: ${instruction}`,
        `- Selected skills (ids): ${skillList}`,
        `- Use AgentExecutor with OPENAI_API_KEY for code edits.`,
      ].join('\n');
    }
    const prompt = `You are an implementation planner. Output a concise markdown plan (bullet list, max 400 words).

Instruction: ${instruction}

Skills to align with: ${skillList}

package.json excerpt:
${manifest.slice(0, 4000)}
`;
    const r = await this.client.responses.create({ model: this.model, input: prompt });
    return r.output_text?.trim() ?? 'No plan text.';
  }
}
