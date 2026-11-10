import process from 'node:process';
import { loadDotEnv, hasOpenAiKey } from './load-env.js';
import { resolveMonorepoRoot, resolvePrimarySyncSourceRoot } from './sdlc/repo-root.js';
import { runSdlcFromArgv } from './sdlc/pipeline.js';

const repoRoot = resolveMonorepoRoot();
loadDotEnv(repoRoot);
const primary = resolvePrimarySyncSourceRoot();
if (primary !== repoRoot) loadDotEnv(primary);

if (!hasOpenAiKey() && !process.env.SDLC_QUIET_ENV_WARN) {
  console.warn(
    `[sdlc] OPENAI_API_KEY not loaded. Add it to ${repoRoot}/.env (or export it). AI implement/review will be skipped.`,
  );
}

runSdlcFromArgv(process.argv.slice(2)).catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
