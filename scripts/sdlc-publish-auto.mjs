#!/usr/bin/env node
/**
 * Publish agent edits: `npm run sdlc -- --publish` with no CLI args — instruction from `SDLC_INSTRUCTION` (e.g. `.env`).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync('npm', ['run', 'sdlc', '--', '--publish'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: process.env,
});
process.exit(result.status ?? 1);
