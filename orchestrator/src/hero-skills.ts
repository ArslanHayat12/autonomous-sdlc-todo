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

export function formatSkillsForPrompt(
  skills: HeroSkill[],
  options?: { maxCharsPerSkill?: number; maxSkills?: number },
): string {
  const maxSkills = options?.maxSkills ?? skills.length;
  const maxChars = options?.maxCharsPerSkill ?? 80_000;
  const slice = skills.slice(0, maxSkills);
  return slice
    .map(s => {
      let body = s.body.trim();
      if (body.length > maxChars) {
        body = `${body.slice(0, maxChars)}\n\n… [skill ${s.id} truncated] …`;
      }
      return `### Skill: ${s.id}\n${body}`;
    })
    .join('\n\n---\n\n');
}
