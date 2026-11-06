import { execFileSync } from 'node:child_process';
import type { AiHeroConfig } from '../../sdlc.config.js';
import { loadHeroSkills, type HeroSkill } from '../hero-skills.js';
import type { SkillInvocation } from './types.js';

export class AIHeroSkillRegistry {
  private skills: HeroSkill[] = [];

  constructor(
    private readonly repoRoot: string,
    private readonly heroCfg: AiHeroConfig,
  ) {}

  async discover(): Promise<HeroSkill[]> {
    this.skills = await loadHeroSkills(this.repoRoot);
    return this.skills;
  }

  /**
   * Optional network install from https://github.com/mattpocock/skills — gated by env.
   */
  async ensureOfficialCatalogIfRequested(): Promise<SkillInvocation | null> {
    if (this.skills.length > 0) return null;
    if (process.env.SDLC_INSTALL_AIHERO_SKILLS !== '1') {
      return {
        skillId: 'catalog-install',
        ran: false,
        mechanism: this.heroCfg.installCommand.join(' '),
        evidence:
          'Skipped: no skills/ entries; set SDLC_INSTALL_AIHERO_SKILLS=1 in a trusted environment to run the official installer.',
      };
    }
    try {
      execFileSync('npx', [...this.heroCfg.installCommand], {
        cwd: this.repoRoot,
        stdio: 'inherit',
      });
      this.skills = await loadHeroSkills(this.repoRoot);
      return {
        skillId: 'catalog-install',
        ran: true,
        mechanism: this.heroCfg.installCommand.join(' '),
        evidence: `skill folders: ${this.skills.map(s => s.id).join(', ') || 'none'}`,
      };
    } catch (e) {
      return {
        skillId: 'catalog-install',
        ran: false,
        mechanism: 'npx',
        evidence: String((e as Error).message),
      };
    }
  }

  getSkills(): HeroSkill[] {
    return this.skills;
  }

  validate(skillIds: string[]): SkillInvocation[] {
    return skillIds.map(id => {
      const found = this.skills.some(s => s.id === id);
      return {
        skillId: id,
        ran: false,
        mechanism: 'validation',
        evidence: found ? 'SKILL.md present' : 'not installed — will not claim Hero execution',
      };
    });
  }
}
