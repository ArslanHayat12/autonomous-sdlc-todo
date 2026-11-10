import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Fix common `.env` typos (e.g. `OPENAI_API_KEY=Y=sk-…`). */
export function normalizeOpenAiKey(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  let val = raw.trim();
  if (!val) return undefined;
  if (val.startsWith('Y=')) val = val.slice(2).trim();
  return val || undefined;
}

export function hasOpenAiKey(): boolean {
  return Boolean(normalizeOpenAiKey(process.env.OPENAI_API_KEY));
}

/** Normalize `process.env.OPENAI_API_KEY` after `loadDotEnv`. */
export function applyOpenAiKeyNormalization(): void {
  const normalized = normalizeOpenAiKey(process.env.OPENAI_API_KEY);
  if (normalized) process.env.OPENAI_API_KEY = normalized;
  else if (process.env.OPENAI_API_KEY?.trim() === '') delete process.env.OPENAI_API_KEY;
}

/** Load repo-root `.env` into `process.env` (does not override existing env vars). */
export function loadDotEnv(repoRoot: string): void {
  const file = path.join(repoRoot, '.env');
  if (!existsSync(file)) return;
  const text = readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    const existing = process.env[key];
    if (existing === undefined || (key === 'OPENAI_API_KEY' && existing.trim() === '')) {
      process.env[key] = val;
    }
  }
}
