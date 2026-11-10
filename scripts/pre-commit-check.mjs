#!/usr/bin/env node
/**
 * Local pre-commit: build + Playwright E2E (Todo happy path).
 * Skip: SKIP_PRE_COMMIT_CHECKS=1 git commit ...
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.SKIP_PRE_COMMIT_CHECKS === '1') {
  console.log('pre-commit: SKIP_PRE_COMMIT_CHECKS=1 — skipping build/e2e');
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log('pre-commit: npm run build');
run('npm', ['run', 'build']);

if (process.env.SKIP_PLAYWRIGHT_PRE_COMMIT === '1') {
  console.log('pre-commit: SKIP_PLAYWRIGHT_PRE_COMMIT=1 — skipping Playwright');
  process.exit(0);
}

console.log('pre-commit: playwright install chromium (if needed)');
spawnSync('npx', ['playwright', 'install', 'chromium'], { cwd: root, stdio: 'inherit', shell: true });

console.log('pre-commit: npm run test:e2e');
run('npm', ['run', 'test:e2e']);

console.log('pre-commit: OK');
