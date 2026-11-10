import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Load one `.env` file into `process.env` (fills missing or empty `OPENAI_API_KEY`). */
export function loadDotEnvFile(file: string): boolean {
  if (!existsSync(file)) return false;
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
    const emptyOpenAi = key === 'OPENAI_API_KEY' && !existing?.trim();
    if (existing === undefined || emptyOpenAi) {
      process.env[key] = val;
    }
  }
  return true;
}

/** Load repo-root `.env` into `process.env`. */
export function loadDotEnv(repoRoot: string): void {
  loadDotEnvFile(path.join(repoRoot, '.env'));
}

export function hasOpenAiKey(): boolean {
  const raw = process.env.OPENAI_API_KEY?.trim() ?? '';
  if (!raw) return false;
  if (raw.startsWith('Y=')) return raw.slice(2).trim().startsWith('sk-');
  return raw.startsWith('sk-');
}
