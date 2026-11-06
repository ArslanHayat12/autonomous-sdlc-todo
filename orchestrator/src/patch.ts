import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type FilePatch = { path: string; content: string };

export function extractJsonObject(raw: string): unknown {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = fence?.[1]?.trim() ?? raw.trim();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1)) as unknown;
    }
    throw new Error('Could not parse JSON from model output.');
  }
}

export function parsePatches(data: unknown): FilePatch[] {
  if (typeof data !== 'object' || data === null || !('patches' in data)) {
    throw new Error('Model output must be a JSON object with a "patches" array.');
  }
  const patches = (data as { patches: unknown }).patches;
  if (!Array.isArray(patches)) throw new Error('"patches" must be an array.');
  const out: FilePatch[] = [];
  for (const p of patches) {
    if (typeof p !== 'object' || p === null) continue;
    const rec = p as { path?: unknown; content?: unknown };
    if (typeof rec.path !== 'string' || typeof rec.content !== 'string') continue;
    const fp = rec.path.replace(/\\/g, '/').replace(/^\//, '');
    if (fp.includes('..')) throw new Error(`Unsafe path in patch: ${rec.path}`);
    out.push({ path: fp, content: rec.content });
  }
  if (out.length === 0) throw new Error('No valid patches in model output.');
  return out;
}

export async function applyPatches(repoRoot: string, patches: FilePatch[]): Promise<string[]> {
  const rootResolved = path.resolve(repoRoot);
  const written: string[] = [];
  for (const p of patches) {
    const target = path.join(repoRoot, p.path);
    if (!path.resolve(target).startsWith(rootResolved + path.sep) && path.resolve(target) !== rootResolved) {
      throw new Error(`Unsafe patch path: ${p.path}`);
    }
    const dir = path.dirname(target);
    await mkdir(dir, { recursive: true });
    await writeFile(target, p.content, 'utf8');
    written.push(p.path);
  }
  return written;
}

export async function readTextFileSafe(repoRoot: string, rel: string, max = 80_000): Promise<string | null> {
  try {
    const target = path.join(repoRoot, rel);
    const resolved = path.resolve(target);
    if (!resolved.startsWith(path.resolve(repoRoot))) return null;
    const buf = await readFile(resolved, 'utf8');
    return buf.length > max ? buf.slice(0, max) + '\n/* … truncated … */\n' : buf;
  } catch {
    return null;
  }
}
