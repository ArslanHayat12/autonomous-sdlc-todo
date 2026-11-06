import { execFileSync } from 'node:child_process';
import process from 'node:process';

export function execGit(cwd: string, args: string[], allowFailure = false): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const err = e as { stderr?: Buffer; status?: number; message?: string };
    const stderr = Buffer.isBuffer(err.stderr) ? err.stderr.toString('utf8').trim() : '';
    const msg = `git ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`;
    if (allowFailure) return `__GIT_FAIL__:${msg}`;
    throw new Error(msg);
  }
}

export function execCmd(
  cwd: string,
  cmd: string,
  args: string[],
  allowFailure = false,
): string {
  try {
    return execFileSync(cmd, args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
  } catch (e) {
    const err = e as { stderr?: Buffer; message?: string };
    const stderr = Buffer.isBuffer(err.stderr) ? err.stderr.toString('utf8').trim() : '';
    const msg = `${cmd} ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}: ${err.message ?? e}`;
    if (allowFailure) return `__CMD_FAIL__:${msg}`;
    throw new Error(msg);
  }
}
