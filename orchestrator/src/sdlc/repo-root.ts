import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Monorepo root (directory with root `package.json` / `sdlc.features.json`).
 * **`SDLC_REPO_ROOT`** forces the root when the orchestrator runs from another clone (worker secondary checkout).
 */
export function resolveMonorepoRoot(): string {
  const env = process.env.SDLC_REPO_ROOT?.trim();
  if (env) return path.resolve(env);
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
}

/**
 * When **`SDLC_WORKER_SYNC_FROM_PRIMARY=1`**, copy uncommitted/sync paths from this checkout into the task worktree
 * (usually your “dirty” Cursor workspace). Defaults to the same as `resolveMonorepoRoot()`.
 */
export function resolvePrimarySyncSourceRoot(): string {
  const primary = process.env.SDLC_PRIMARY_REPO_ROOT?.trim();
  if (process.env.SDLC_WORKER_SYNC_FROM_PRIMARY === '1' && primary) {
    return path.resolve(primary);
  }
  return resolveMonorepoRoot();
}
