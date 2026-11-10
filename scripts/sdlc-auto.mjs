#!/usr/bin/env node
/**
 * Run SDLC with no CLI args — instruction comes from env `SDLC_INSTRUCTION` (e.g. in `.env`).
 * Usage: `npm run sdlc:auto`
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function loadDotEnv(root) {
  const file = path.join(root, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadDotEnv(root);
const result = spawnSync('npm', ['run', 'sdlc', '--'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: process.env,
});
process.exit(result.status ?? 1);
