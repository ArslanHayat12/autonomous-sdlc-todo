import process from 'node:process';
import { loadDotEnv } from './load-env.js';
import { resolveMonorepoRoot } from './sdlc/repo-root.js';
import { runSdlcFromArgv } from './sdlc/pipeline.js';

loadDotEnv(resolveMonorepoRoot());

runSdlcFromArgv(process.argv.slice(2)).catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
