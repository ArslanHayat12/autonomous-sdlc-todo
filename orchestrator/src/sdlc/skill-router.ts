import type { AiHeroConfig } from '../../sdlc.config.js';
import type { HeroSkill } from '../hero-skills.js';

export class SkillRouter {
  constructor(private readonly cfg: AiHeroConfig) {}

  selectForInstruction(instruction: string, all: HeroSkill[]): HeroSkill[] {
    const low = instruction.toLowerCase();
    const picked = new Set<string>();
    for (const [kw, ids] of Object.entries(this.cfg.routingKeywords)) {
      if (low.includes(kw)) {
        for (const id of ids) picked.add(id);
      }
    }
    const selected = all.filter(s => picked.has(s.id));
    return selected.length ? selected : all.slice(0, Math.min(4, all.length));
  }
}
