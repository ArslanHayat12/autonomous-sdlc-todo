import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

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
    const refillOpenAi = key === 'OPENAI_API_KEY' && !existing?.trim();
    if (existing === undefined || refillOpenAi) {
      process.env[key] = val;
    }
  }
  return true;
}

export function loadDotEnv(repoRoot: string): void {
  loadDotEnvFile(path.join(repoRoot, '.env'));
}

export function normalizeOpenAiKey(raw?: string): string | null {
  let k = raw?.trim() ?? '';
  if (!k) return null;
  if (k.startsWith('Y=')) k = k.slice(2).trim();
  return k || null;
}

export function hasOpenAiKey(): boolean {
  const k = normalizeOpenAiKey(process.env.OPENAI_API_KEY);
  return Boolean(k?.startsWith('sk-'));
}
