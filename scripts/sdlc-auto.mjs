#!/usr/bin/env node
/**
 * Run SDLC with no CLI args — instruction comes from env `SDLC_INSTRUCTION` (e.g. in `.env`).
 * Usage: `npm run sdlc:auto`
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync('npm', ['run', 'sdlc', '--'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: process.env,
});
process.exit(result.status ?? 1);
