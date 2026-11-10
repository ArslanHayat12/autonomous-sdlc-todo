import { execFileSync, execSync } from 'node:child_process';
import type { QualityGatesConfig, GatePolicy } from '../../sdlc.config.js';
import type { GateResult } from './types.js';
import { sdlcChildProcessEnv } from './worktree-env.js';

function now(): number {
  return Date.now();
}

export class TestRunner {
  runInWorktree(
    cwd: string,
    cmd: string,
    args: string[],
    timeoutMs: number,
  ): { ok: boolean; output: string } {
    const start = now();
    try {
      const out = execFileSync(cmd, args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: sdlcChildProcessEnv(),
        timeout: timeoutMs,
      });
      return { ok: true, output: String(out) };
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      const out = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n');
      return { ok: false, output: out || String(e) };
    } finally {
      void start;
    }
  }

  runShell(cwd: string, command: string, timeoutMs: number): { ok: boolean; output: string } {
    if (!command.trim()) return { ok: false, output: 'No command configured.' };
    try {
      const shell = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : '/bin/sh';
      const out = execSync(command, {
        cwd,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: sdlcChildProcessEnv(),
        timeout: timeoutMs,
        shell,
      });
      return { ok: true, output: String(out) };
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      const out = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n');
      return { ok: false, output: out || String(e) };
    }
  }
}

export class SecurityScanner {
  audit(cwd: string, timeoutMs: number): { ok: boolean; output: string } {
    const tr = new TestRunner();
    return tr.runInWorktree(cwd, 'npm', ['audit', '--audit-level=high'], timeoutMs);
  }

  simpleSecretScan(_cwd: string): { hits: string[] } {
    /** Minimal built-in check — disabled gate uses this optionally */
    return { hits: [] };
  }
}

export class QualityGateOrchestrator {
  constructor(private readonly gates: QualityGatesConfig) {}

  async runGate(
    id: keyof QualityGatesConfig,
    cwd: string,
    runner: (policy: GatePolicy) => Promise<{ ok: boolean; output: string }>,
  ): Promise<GateResult> {
    const policy = this.gates[id];
    const start = now();
    if (!policy.enabled) {
      return {
        id,
        status: 'skipped',
        durationMs: 0,
        output: `Gate ${id} disabled in sdlc.config.ts (not executed).`,
        mandatory: policy.mandatory,
      };
    }
    let attempt = 0;
    let lastOut = '';
    let ok = false;
    while (attempt < policy.retry.maxAttempts) {
      attempt++;
      const r = await runner(policy);
      lastOut = r.output;
      ok = r.ok;
      if (ok) break;
      await new Promise(r => setTimeout(r, policy.retry.backoffMs));
    }
    return {
      id,
      status: ok ? 'passed' : policy.mandatory ? 'failed' : 'error',
      durationMs: now() - start,
      output: lastOut.slice(-12000),
      mandatory: policy.mandatory,
    };
  }

  mandatoryFailures(results: GateResult[]): GateResult[] {
    return results.filter(
      g => g.mandatory && (g.status === 'failed' || g.status === 'error'),
    );
  }

  skippedReport(results: GateResult[]): string {
    return results
      .filter(g => g.status === 'skipped')
      .map(g => `- ${g.id}: skipped (not counted as passed)`)
      .join('\n');
  }
}
