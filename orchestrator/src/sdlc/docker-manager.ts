import { execFileSync } from 'node:child_process';
import type { DockerConfig } from '../../sdlc.config.js';

export type HealthCheck = { name: string; ok: boolean; detail: string };

export class DockerManager {
  constructor(private readonly cfg: DockerConfig) {}

  build(mainRepoRoot: string, tag: string): { ok: boolean; output: string } {
    if (!this.cfg.enabled) return { ok: true, output: 'Docker disabled in config.' };
    try {
      const out = execFileSync(
        'docker',
        ['compose', '-f', this.cfg.composeFile, 'build', ...this.cfg.buildServices],
        { cwd: mainRepoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      void tag;
      return { ok: true, output: String(out).slice(-8000) };
    } catch (e) {
      return { ok: false, output: String((e as Error).message) };
    }
  }

  upDetached(mainRepoRoot: string): { ok: boolean; output: string } {
    if (!this.cfg.enabled) return { ok: true, output: 'Docker disabled.' };
    try {
      const args = ['compose', '-f', this.cfg.composeFile, 'up', '-d', '--build'];
      const out = execFileSync('docker', args, {
        cwd: mainRepoRoot,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      });
      return { ok: true, output: String(out).slice(-4000) };
    } catch (e) {
      return { ok: false, output: String((e as Error).message) };
    }
  }

  healthChecks(): HealthCheck[] {
    const results: HealthCheck[] = [];
    const deadline = Date.now() + this.cfg.healthTimeoutMs;
    for (const h of this.cfg.healthUrls) {
      let ok = false;
      let detail = '';
      while (Date.now() < deadline) {
        try {
          execFileSync('curl', ['-sf', h.url], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 });
          ok = true;
          detail = 'HTTP OK';
          break;
        } catch (e) {
          detail = String((e as Error).message);
          /* spin */
        }
      }
      results.push({ name: h.name, ok, detail });
    }
    return results;
  }
}
