import { pushAndOpenPr, updatePrDescription, resolveGitHubRepo } from '../gh-pr.js';
import type { WorktreeSession } from '../worktree.js';
import type { SdlcConfig } from '../../sdlc.config.js';

export class PullRequestManager {
  constructor(private readonly cfg: SdlcConfig) {}

  renderTitle(instruction: string): string {
    const short = instruction.replace(/\s+/g, ' ').trim().slice(0, 72);
    return this.cfg.github.prTitleTemplate.replace(/\{\{instructionShort\}\}/g, short);
  }

  async createOrUpdate(
    session: WorktreeSession,
    instruction: string,
    body: string,
  ): Promise<{ prUrl: string | null; message: string; prNumber: number | null }> {
    const labels = this.cfg.github.autoLabel ? [...this.cfg.github.labels] : [];
    const title = this.renderTitle(instruction);
    return pushAndOpenPr(session, title, body, labels);
  }

  async updateBody(session: WorktreeSession, body: string): Promise<string | null> {
    return updatePrDescription(session, body, session.branch);
  }

  resolveOwnerRepo(session: WorktreeSession): { owner: string; repo: string } | null {
    return resolveGitHubRepo(session);
  }
}
