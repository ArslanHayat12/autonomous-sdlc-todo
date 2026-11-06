import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sdlcConfig, type SdlcConfig } from '../../sdlc.config.js';

/**
 * Toggle file (JSON) at repository root — edit this to enable/disable SDLC automation
 * without changing TypeScript. Loaded at runtime; merged into `sdlcConfig`.
 */
export type SdlcFeatureFlags = {
  /** Use linked git worktree under `.sdlc-worktrees` (recommended; keeps main dirty tree safe). If false, runs on a new branch in the main clone (requires clean tree). */
  isolatedWorktree: boolean;
  /** Remove old `sdlc__agent-*` worktrees before each run (saves disk). */
  pruneStaleWorktreesOnStart: boolean;
  /** OpenAI JSON patches + apply (or fallback when no API key). */
  autoImplement: boolean;
  /** Load each repo skill (skills/<name>/SKILL.md) and route into plan/review prompts. */
  aiHeroSkills: boolean;
  /** AI code-review loop after PR creation (requires OPENAI_API_KEY). */
  aiReview: boolean;
  /** Run build / audit / e2e / optional gates from sdlc.config.ts. */
  qualityGates: boolean;
  /** git commit task changes in the worktree. */
  autoCommit: boolean;
  /** git push feature branch. */
  autoPush: boolean;
  /** gh pr create. */
  autoPr: boolean;
  /** gh pr merge (subject to GitHub branch protection). */
  autoMerge: boolean;
  /** After successful merge: docker compose up (local). */
  autoDeployLocal: boolean;
  /** Copy uncommitted files from main checkout into the SDLC worktree (so local edits get committed on the feature branch). */
  syncUncommittedFromMain: boolean;
  /** Before worktree: if checkout is clean and on `git.baseBranch`, `git fetch` + `merge --ff-only origin/<baseBranch>`. */
  autoPullMainBeforeRun: boolean;
  /** After a PR is opened: same fast-forward on main (optional; keeps local base current). */
  autoPullMainAfterPr: boolean;
  /** After a successful merge (local policy): same fast-forward so local `main` includes the merge commit. */
  autoPullMainAfterMerge: boolean;
  /** When OPENAI_API_KEY is set and Hero skills were selected, use the model to draft the conventional commit (skill-aware); else template. */
  autoCommitMessageFromSkills: boolean;
};

const defaultFlags: SdlcFeatureFlags = {
  isolatedWorktree: true,
  pruneStaleWorktreesOnStart: true,
  autoImplement: true,
  aiHeroSkills: true,
  aiReview: true,
  qualityGates: true,
  autoCommit: true,
  autoPush: true,
  autoPr: true,
  autoMerge: true,
  autoDeployLocal: false,
  syncUncommittedFromMain: true,
  autoPullMainBeforeRun: true,
  autoPullMainAfterPr: true,
  autoPullMainAfterMerge: true,
  autoCommitMessageFromSkills: true,
};

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/**
 * Loads optional `sdlc.features.json` from the monorepo root (next to root package.json).
 */
export async function loadFeatureFlags(repoRoot: string): Promise<SdlcFeatureFlags> {
  const file = path.join(repoRoot, 'sdlc.features.json');
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return { ...defaultFlags, ...parsed } as SdlcFeatureFlags;
  } catch {
    return { ...defaultFlags };
  }
}

/**
 * Apply feature toggles to a copy of `sdlcConfig` so `sdlc.config.ts` stays the structural default.
 */
export type SdlcConfigWithFeatures = SdlcConfig & { features: SdlcFeatureFlags };

export function applyFeatureFlagsToConfig(base: SdlcConfig, f: SdlcFeatureFlags): SdlcConfigWithFeatures {
  const c = deepClone(base) as SdlcConfigWithFeatures;
  c.features = { ...f };
  c.git.worktreesEnabled = f.isolatedWorktree;
  c.git.pruneStaleWorktreesOnStart = f.pruneStaleWorktreesOnStart;
  c.git.autoStage = f.autoCommit;
  c.git.autoCommit = f.autoCommit;
  c.git.autoPush = f.autoPush;
  c.git.autoCreatePr = f.autoPr;
  c.git.autoMerge = f.autoMerge;

  if (!f.aiHeroSkills) {
    c.aiHero.discoveryEnabled = false;
    c.aiHero.selectionEnabled = false;
    c.aiHero.executionEnabled = false;
    c.aiHero.validationEnabled = false;
  }
  if (!f.qualityGates) {
    for (const k of Object.keys(c.qualityGates) as (keyof typeof c.qualityGates)[]) {
      c.qualityGates[k] = { ...c.qualityGates[k], enabled: false, mandatory: false };
    }
  }
  /* `autoDeployLocal` only affects the post-merge compose step (see pipeline); docker build gate still follows sdlc.config.ts */
  return c;
}

/** For dry-run / tests: resolve repo root from orchestrator package location. */
export async function loadMergedConfigFromRepoRoot(repoRoot: string): Promise<SdlcConfigWithFeatures> {
  const flags = await loadFeatureFlags(repoRoot);
  return applyFeatureFlagsToConfig(sdlcConfig, flags);
}
