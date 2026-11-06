import { execGit } from '../git-exec.js';
import type { SdlcConfig } from '../../sdlc.config.js';
import { DockerManager } from './docker-manager.js';

export class DeploymentManager {
  constructor(
    private readonly cfg: SdlcConfig,
    private readonly docker: DockerManager,
  ) {}

  /** Fetch remote main without checking out (preserves dirty working tree). */
  fetchMain(mainRepoRoot: string): void {
    execGit(mainRepoRoot, ['fetch', 'origin', this.cfg.git.baseBranch], true);
  }

  deployLocal(mainRepoRoot: string, shortSha: string): ReturnType<DockerManager['upDetached']> & { tag: string } {
    const tag = this.cfg.docker.imageTagTemplate.replace('{{shortSha}}', shortSha);
    this.fetchMain(mainRepoRoot);
    const up = this.docker.upDetached(mainRepoRoot);
    return { ...up, tag };
  }
}
