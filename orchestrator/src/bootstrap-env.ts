/**
 * Load repo-root `.env` before any SDLC code reads `process.env`.
 * Import this module first from CLI / worker / pipeline entrypoints.
 */
import { loadDotEnv, hasOpenAiKey } from './load-env.js';
import { resolveMonorepoRoot, resolvePrimarySyncSourceRoot } from './sdlc/repo-root.js';

export function bootstrapSdlcEnv(): string {
  const repoRoot = resolveMonorepoRoot();
  loadDotEnv(repoRoot);
  const primary = resolvePrimarySyncSourceRoot();
  if (primary !== repoRoot) loadDotEnv(primary);
  return repoRoot;
}

export function warnIfMissingOpenAiKey(repoRoot: string): void {
  if (hasOpenAiKey() || process.env.SDLC_QUIET_ENV_WARN === '1') return;
  console.warn(
    `[sdlc] OPENAI_API_KEY not loaded. Put it in ${repoRoot}/.env then re-run. AI implement/review will be skipped.`,
  );
}
