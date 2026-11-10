/**
 * Load repo-root `.env` before any SDLC code reads `process.env`.
 * Import this module first from CLI / worker / pipeline entrypoints.
 */
import { applyGitHubEnvNormalization, applyOpenAiKeyNormalization, loadDotEnv, hasOpenAiKey } from './load-env.js';
import { resolveMonorepoRoot, resolvePrimarySyncSourceRoot } from './sdlc/repo-root.js';

export function bootstrapSdlcEnv(): string {
  const repoRoot = resolveMonorepoRoot();
  loadDotEnv(repoRoot);
  const primary = resolvePrimarySyncSourceRoot();
  if (primary !== repoRoot) loadDotEnv(primary);
  applyOpenAiKeyNormalization();
  applyGitHubEnvNormalization();
  return repoRoot;
}

export function warnIfGhNotReady(repoRoot: string): void {
  if (process.env.SDLC_QUIET_ENV_WARN === '1') return;
  const hasToken = Boolean(process.env.GH_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim());
  if (!hasToken) {
    console.warn(
      `[sdlc] No GITHUB_TOKEN/GH_TOKEN in ${repoRoot}/.env — \`gh pr create/merge\` may fail. Run \`gh auth login\` or set a classic token with repo scope.`,
    );
  }
}

export function warnIfMissingOpenAiKey(repoRoot: string): void {
  if (hasOpenAiKey() || process.env.SDLC_QUIET_ENV_WARN === '1') return;
  console.warn(
    `[sdlc] OPENAI_API_KEY not loaded. Put it in ${repoRoot}/.env then re-run. AI implement/review will be skipped.`,
  );
}
