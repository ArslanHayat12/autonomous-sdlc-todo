import type { TestRunner } from './quality-runner.js';
import type { WorktreeSession } from '../worktree.js';

let chromiumInstallDone = false;

/** Install Chromium once per process when Playwright E2E is about to run. */
export function ensurePlaywrightChromium(
  session: WorktreeSession,
  run: (session: WorktreeSession, cmd: string, args: string[]) => void,
): void {
  if (chromiumInstallDone || process.env.SDLC_SKIP_PLAYWRIGHT === '1') return;
  run(session, 'npx', ['playwright', 'install', 'chromium']);
  chromiumInstallDone = true;
}

export function runPlaywrightE2e(
  testRunner: TestRunner,
  cwd: string,
  timeoutMs: number,
): { ok: boolean; output: string } {
  if (process.env.SDLC_SKIP_PLAYWRIGHT === '1') {
    return { ok: false, output: 'Skipped via SDLC_SKIP_PLAYWRIGHT=1 (not counted as passed).' };
  }
  return testRunner.runInWorktree(cwd, 'npx', ['playwright', 'test'], timeoutMs);
}
