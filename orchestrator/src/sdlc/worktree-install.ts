import { execFileSync } from 'node:child_process';
import type { WorktreeSession } from '../worktree.js';

const INSTALL_TIMEOUT_MS = 15 * 60_000;

/** Env for non-interactive npm in SDLC worktrees (skip Husky hooks). */
export function worktreeChildEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HUSKY: '0',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
  };
}

/**
 * Install workspace deps in the isolated worktree.
 * Uses `--ignore-scripts` by default (faster; set `SDLC_NPM_INSTALL_FULL=1` for full install).
 */
export function installWorktreeDependencies(session: WorktreeSession): { ok: boolean; output: string; ms: number } {
  const start = Date.now();
  const args =
    process.env.SDLC_NPM_INSTALL_FULL === '1'
      ? ['install']
      : ['install', '--ignore-scripts', '--no-fund', '--no-audit'];
  try {
    const out = execFileSync('npm', args, {
      cwd: session.path,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: worktreeChildEnv(),
      timeout: INSTALL_TIMEOUT_MS,
    });
    return { ok: true, output: String(out).trim(), ms: Date.now() - start };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const output = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n');
    return { ok: false, output: output || String(e), ms: Date.now() - start };
  }
}
