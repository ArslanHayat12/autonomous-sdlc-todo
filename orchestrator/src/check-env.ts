/**
 * `npm run sdlc:check-env` — verify repo `.env` is loaded (never prints the key).
 */
import './env-preload.js';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { hasOpenAiKey } from './load-env.js';
import { resolveMonorepoRoot } from './sdlc/repo-root.js';

const root = resolveMonorepoRoot();
const envFile = path.join(root, '.env');
console.log(`Repo root: ${root}`);
console.log(`.env file: ${existsSync(envFile) ? 'found' : 'MISSING'}`);
console.log(
  `AI key ready (from shell or .env): ${hasOpenAiKey() ? 'yes' : 'no'} — blank shell is fine when .env has OPENAI_API_KEY`,
);
if (!hasOpenAiKey()) {
  process.exitCode = 1;
}
