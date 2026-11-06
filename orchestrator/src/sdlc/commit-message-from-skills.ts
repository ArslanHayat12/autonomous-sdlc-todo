import type OpenAI from 'openai';
import type { HeroSkill } from '../hero-skills.js';
import type { CommitBody } from './commit-message-generator.js';
import { CommitMessageGenerator } from './commit-message-generator.js';

function stripConventionalTitle(line: string): string {
  const t = line.replace(/\s+/g, ' ').trim();
  const conventional = /^(?:\w+(?:\([^)]+\))?!?:\s*)(.+)$/i.exec(t);
  return (conventional ? conventional[1] : t).slice(0, 72);
}

/**
 * Draft conventional commit title + body using OpenAI + selected Hero SKILL.md context.
 * Falls back to template when no client or on parse failure.
 */
export async function buildCommitMessageWithSkills(options: {
  client: OpenAI | null;
  model: string;
  instruction: string;
  selectedSkills: HeroSkill[];
  implementationSummary: string;
  gateSummary: string;
  fallbackBody: CommitBody;
}): Promise<{ title: string; body: string }> {
  const gen = new CommitMessageGenerator();
  const fbTitle = gen.generateTitle('sdlc', options.implementationSummary || options.instruction);
  const fbBody = gen.generateBody(options.fallbackBody);

  if (!options.client || options.selectedSkills.length === 0) {
    return { title: fbTitle, body: fbBody };
  }

  const skillSnippets = options.selectedSkills
    .map(s => `### ${s.id}\n${s.body.slice(0, 2500)}`)
    .join('\n\n---\n\n');

  const prompt = `You write git commit messages for an autonomous SDLC pipeline.

Instruction / requirement:
${options.instruction}

Implementation summary:
${options.implementationSummary || '(none)'}

Quality gates summary (may be short):
${options.gateSummary.slice(0, 2000)}

Selected Hero skills (SKILL.md excerpts — align wording with these themes):
${skillSnippets}

Output EXACTLY two lines, then the body:
LINE1: A single conventional-commit title: type(scope): description
  - type: feat|fix|docs|chore|refactor|test|perf|ci as appropriate; use scope "sdlc" unless another fits better.
  - Max 72 characters for the full LINE1.
LINE2: (blank line separator — output a single empty line)
Then a multi-line commit body in the same style as:
Why: ...
What: ...
Components: ...
Architecture: ...
Security: ...
Tests & validation: ...
Breaking: ...

Use "Breaking: none" if none. Keep total body under 3500 characters.`;

  try {
    const r = await options.client.responses.create({ model: options.model, input: prompt });
    const raw = r.output_text?.trim() ?? '';
    const lines = raw.split(/\r?\n/);
    let title = lines[0]?.trim() ?? '';
    if (!/^[a-z]+(\([^)]+\))?!?:\s+\S/.test(title)) {
      title = fbTitle;
    } else {
      /** Normalize scope if model omitted it weirdly */
      if (!title.includes('(')) {
        const desc = stripConventionalTitle(title);
        title = `feat(sdlc): ${desc}`;
      }
      if (title.length > 72) title = title.slice(0, 72);
    }
    const firstBlank = lines.findIndex((l, i) => i > 0 && l.trim() === '');
    const bodyLines = firstBlank >= 0 ? lines.slice(firstBlank + 1) : lines.slice(1);
    let body = bodyLines.join('\n').trim();
    if (body.length < 20) body = fbBody;
    return { title, body };
  } catch {
    return { title: fbTitle, body: fbBody };
  }
}
