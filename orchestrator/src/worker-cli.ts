import process from 'node:process';
import { bootstrapSdlcEnv, warnIfMissingOpenAiKey } from './bootstrap-env.js';
import { runWorkerMain } from './sdlc/worker.js';

const repoRoot = bootstrapSdlcEnv();
warnIfMissingOpenAiKey(repoRoot);

runWorkerMain(process.argv.slice(2)).catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
