import { execFileSync } from 'node:child_process';
import type { DockerConfig } from '../../sdlc.config.js';

export class RollbackManager {
  constructor(private readonly cfg: DockerConfig) {}

  down(mainRepoRoot: string): string {
    if (!this.cfg.enabled) return 'Docker disabled.';
    try {
      execFileSync('docker', ['compose', '-f', this.cfg.composeFile, 'down'], {
        cwd: mainRepoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return 'docker compose down executed.';
    } catch (e) {
      return String((e as Error).message);
    }
  }
}
