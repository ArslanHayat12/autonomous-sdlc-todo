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
    ctx: { paths: string[]; repoRoot: string; buildFeedback?: string },
  ): Promise<{ patches: import('../patch.js').FilePatch[]; summary: string }> {
    const parts: string[] = [];
    for (const p of ctx.paths) {
      const text = await readTextFileSafe(ctx.repoRoot, p);
      if (text === null) continue;
      parts.push(`--- FILE: ${p} ---\n${text}`);
    }
    const system = `You implement repository changes. Output ONLY valid JSON with shape:
{"summary":"short","patches":[{"path":"relative/path.ts","content":"full new file content"}]}
Paths must be repo-relative forward slashes.
Patches MUST keep \`npm run build\` passing (strict TypeScript). For Express 5, \`req.params.*\` is \`string | string[]\` — use \`routeParam\` from apps/api/src/route-params.ts when touching API routes. After \`parseTitle\`, narrow with \`if (!parsed.ok) return\` then destructure \`const { title } = parsed\`.`;

    const buildBlock = ctx.buildFeedback?.trim()
      ? `\n\nPrevious build FAILED — fix these errors in your patches:\n\`\`\`\n${ctx.buildFeedback.slice(-4000)}\n\`\`\`\n`
      : '';

    const user = `${system}\n\nInstruction:\n${instruction}${buildBlock}\n\nFiles:\n${parts.join('\n\n')}`;
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
): Promise<import('../patch.js').FilePatch[]> {
  const low = instruction.toLowerCase();
  if (!low.includes('console')) return [];
  try {
    const mainTsx = path.join(repoRoot, 'apps/web/src/main.tsx');
    const src = await readFile(mainTsx, 'utf8');
    if (src.includes('orchestrator task') || /console\.log\s*\(/.test(src)) return [];
    const hook = "  React.useEffect(() => { console.log('[SDLC]', 'orchestrator task'); }, []);\n";
    if (src.includes('function App()')) {
      const idx = src.indexOf('function App()');
      const brace = src.indexOf('{', idx);
      const next = src.slice(0, brace + 1) + '\n' + hook + src.slice(brace + 1);
      return [{ path: 'apps/web/src/main.tsx', content: next }];
    }
  } catch {
    /* skip */
  }
  return [];
}
