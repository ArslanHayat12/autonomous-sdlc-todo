import process from 'node:process';
import { loadDotEnv } from './load-env.js';
import { resolveMonorepoRoot, resolvePrimarySyncSourceRoot } from './sdlc/repo-root.js';
import { runWorkerMain } from './sdlc/worker.js';

const repoRoot = resolveMonorepoRoot();
loadDotEnv(repoRoot);
loadDotEnv(resolvePrimarySyncSourceRoot());

runWorkerMain(process.argv.slice(2)).catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
