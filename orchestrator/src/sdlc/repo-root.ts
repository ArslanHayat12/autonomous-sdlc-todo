import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function looksLikeSdlcRepoRoot(dir: string): boolean {
  return (
    existsSync(path.join(dir, 'sdlc.features.json')) ||
    (existsSync(path.join(dir, 'package.json')) && existsSync(path.join(dir, 'orchestrator')))
  );
}

function walkUpForRepoRoot(start: string): string | null {
  let dir = path.resolve(start);
  while (true) {
    if (looksLikeSdlcRepoRoot(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Monorepo root (directory with root `package.json` / `sdlc.features.json`).
 * **`SDLC_REPO_ROOT`** forces the root when the orchestrator runs from another clone (worker secondary checkout).
 */
export function resolveMonorepoRoot(): string {
  const env = process.env.SDLC_REPO_ROOT?.trim();
  if (env) return path.resolve(env);

  const fromModule = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  if (looksLikeSdlcRepoRoot(fromModule)) return fromModule;

  const fromCwd = walkUpForRepoRoot(process.cwd());
  if (fromCwd) return fromCwd;

  return fromModule;
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
