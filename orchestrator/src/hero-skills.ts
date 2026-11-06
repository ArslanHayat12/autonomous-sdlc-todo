import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export type HeroSkill = { id: string; name: string; body: string };

/**
 * Loads Hero review skills: repository `skills/<id>/SKILL.md` (installed catalog).
 */
export async function loadHeroSkills(repoRoot: string): Promise<HeroSkill[]> {
  const skillsRoot = path.join(repoRoot, 'skills');
  let names: string[] = [];
  try {
    names = await readdir(skillsRoot, { withFileTypes: true }).then(entries =>
      entries.filter(d => d.isDirectory()).map(d => d.name),
    );
  } catch {
    return [];
  }
  const out: HeroSkill[] = [];
  for (const id of names) {
    const file = path.join(skillsRoot, id, 'SKILL.md');
    try {
      const body = await readFile(file, 'utf8');
      out.push({ id, name: id.replace(/-/g, ' '), body });
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function formatSkillsForPrompt(skills: HeroSkill[]): string {
  return skills.map(s => `### Skill: ${s.id}\n${s.body.trim()}`).join('\n\n---\n\n');
}
