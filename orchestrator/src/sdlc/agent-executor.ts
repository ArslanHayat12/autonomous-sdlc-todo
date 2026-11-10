import OpenAI from 'openai';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { applyPatches, extractJsonObject, parsePatches, readTextFileSafe } from '../patch.js';

export class AgentExecutor {
  constructor(
    private client: OpenAI,
    private model: string,
  ) {}

  async implement(
    instruction: string,
    ctx: { paths: string[]; repoRoot: string },
  ): Promise<{ patches: import('../patch.js').FilePatch[]; summary: string }> {
    const parts: string[] = [];
    for (const p of ctx.paths) {
      const text = await readTextFileSafe(ctx.repoRoot, p);
      if (text === null) continue;
      parts.push(`--- FILE: ${p} ---\n${text}`);
    }
    const system = `You implement repository changes. Output ONLY valid JSON with shape:
{"summary":"short","patches":[{"path":"relative/path.ts","content":"full new file content"}]}
Paths must be repo-relative forward slashes.`;

    const user = `${system}\n\nInstruction:\n${instruction}\n\nFiles:\n${parts.join('\n\n')}`;
    const r = await this.client.responses.create({ model: this.model, input: user });
    const text = r.output_text ?? '';
    const data = extractJsonObject(text);
    const patches = parsePatches(data);
    const summary =
      typeof (data as { summary?: unknown }).summary === 'string'
        ? (data as { summary: string }).summary
        : 'Implementation applied.';
    return { patches, summary };
  }

  async apply(repoRoot: string, patches: import('../patch.js').FilePatch[]): Promise<void> {
    await applyPatches(repoRoot, patches);
  }
}

export async function fallbackConsoleLogPatch(
  repoRoot: string,
  instruction: string,
  candidatePaths: string[] = [],
): Promise<import('../patch.js').FilePatch[]> {
  const low = instruction.toLowerCase();
  if (!low.includes('console')) return [];
  for (const rel of candidatePaths) {
    if (!/\.(tsx|jsx|ts|js)$/.test(rel)) continue;
    try {
      const abs = path.join(repoRoot, rel);
      const src = await readFile(abs, 'utf8');
      if (src.includes('[SDLC]') || /console\.log\s*\(/.test(src)) continue;
      const hook =
        rel.endsWith('.tsx') || rel.endsWith('.jsx')
          ? "  useEffect(() => { console.log('[SDLC]', 'orchestrator task'); }, []);\n"
          : "console.log('[SDLC]', 'orchestrator task');\n";
      if (src.includes('function ') || src.includes('export default function')) {
        const fn = src.indexOf('function ');
        const brace = src.indexOf('{', fn > -1 ? fn : 0);
        if (brace > -1) {
          const next = src.slice(0, brace + 1) + '\n' + hook + src.slice(brace + 1);
          return [{ path: rel.replace(/\\/g, '/'), content: next }];
        }
      }
    } catch {
      continue;
    }
  }
  return [];
}
