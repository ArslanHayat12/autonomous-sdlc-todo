import { createHash } from 'node:crypto';

export type FeatureBranchNaming = 'semantic' | 'timestamp';

const BRANCH_MAX = 72;
const SLUG_MAX = 44;

function uniqueSuffix(seed: string): string {
  const h = createHash('sha256').update(`${seed}\n${Date.now()}`).digest('hex');
  return h.slice(0, 6);
}

/** Git-safe slug: lowercase kebab, no leading/trailing dashes. */
export function slugifyForBranch(text: string): string {
  let s = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (s.length > SLUG_MAX) {
    s = s.slice(0, SLUG_MAX).replace(/-[^-]*$/, '').replace(/-$/, '');
  }
  return s || 'sdlc-change';
}

/** Conventional branch type from natural-language instruction (feat/fix/chore/…). */
export function inferBranchType(instruction: string): string {
  const t = instruction.toLowerCase();
  if (/\b(hotfix|fix|bug|patch|resolve|broken|regression|error|crash|500)\b/.test(t)) return 'fix';
  if (/\b(refactor|restructure|reorganize|extract|split|move|rename)\b/.test(t)) return 'refactor';
  if (/\b(doc|docs|readme|document|comment)\b/.test(t)) return 'docs';
  if (/\b(test|e2e|playwright|coverage|spec)\b/.test(t)) return 'test';
  if (/\b(ci|workflow|github actions|pipeline)\b/.test(t)) return 'ci';
  if (/\b(perf|performance|optimi[sz]e|slow|latency)\b/.test(t)) return 'perf';
  if (/\b(chore|bump|upgrade|dependency|deps|config)\b/.test(t)) return 'chore';
  return 'feat';
}

export type BuildBranchNameOptions = {
  naming?: FeatureBranchNaming;
  /** Legacy timestamp branches: `prefix` + ISO stamp (e.g. `sdlc/agent-…`) */
  legacyPrefix?: string;
  /** Optional scope for semantic names: `feat/scope-slug-abc123` */
  scope?: string;
  /** Publish / agent publish runs */
  publish?: boolean;
};

/**
 * Senior-style branch: `{type}/{slug}-{6char}` (e.g. `feat/add-todo-filters-a3f91b`).
 * Timestamp mode keeps historical `sdlc/agent-<stamp>` behavior.
 */
export function buildFeatureBranchName(instruction: string, options: BuildBranchNameOptions = {}): string {
  const naming = options.naming ?? 'semantic';
  if (naming === 'timestamp') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const prefix = options.legacyPrefix ?? 'sdlc/agent-';
    return `${prefix}${stamp}`;
  }

  const type = options.publish ? 'chore' : inferBranchType(instruction);
  const slugBase = options.publish ? `publish-${slugifyForBranch(instruction)}` : slugifyForBranch(instruction);
  const suffix = uniqueSuffix(instruction);
  const scopePart = options.scope?.trim().replace(/\/+$/, '').replace(/\/+/g, '-');
  const middle = scopePart ? `${scopePart}-${slugBase}` : slugBase;
  let branch = `${type}/${middle}-${suffix}`;
  if (branch.length > BRANCH_MAX) {
    const over = branch.length - BRANCH_MAX;
    const trimmedMiddle = middle.slice(0, Math.max(8, middle.length - over));
    branch = `${type}/${trimmedMiddle}-${suffix}`;
  }
  return branch.replace(/\/+/g, '/');
}
