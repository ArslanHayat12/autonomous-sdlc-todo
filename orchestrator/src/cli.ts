import process from 'node:process';
import { bootstrapSdlcEnv, warnIfMissingOpenAiKey } from './bootstrap-env.js';
import { runSdlcFromArgv } from './sdlc/pipeline.js';

const repoRoot = bootstrapSdlcEnv();
warnIfMissingOpenAiKey(repoRoot);

runSdlcFromArgv(process.argv.slice(2)).catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
