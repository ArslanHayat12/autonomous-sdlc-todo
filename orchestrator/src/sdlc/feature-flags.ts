import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sdlcConfig, type SdlcConfig } from '../../sdlc.config.js';
import { applyProjectProfile, loadProjectProfile, type SdlcProjectProfile } from './project-profile.js';
import { isPlainObject } from './json-config.js';

const FEATURE_GROUPS = [
  'automation',
  'ai',
  'git',
  'delivery',
  'quality',
  'deploy',
  'integrations',
] as const;

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
  /**
   * One-switch **no-human-on-merge** path: forces `autoCommit`, `autoPush`, `autoPr`, `autoMerge` and `requireHumanApprovalBeforeMerge: false`.
   */
  fullAgentAutomation: boolean;
  /**
   * When `true`, do **not** run `gh pr merge` — merge on GitHub manually.
   * When `false` (default with `fullAgentAutomation`), CLI attempts merge after the PR.
   */
  requireHumanApprovalBeforeMerge: boolean;
  /**
   * Before creating the worktree, run a **verification** command on the **main repo checkout** (e.g. `npm run build`).
   * Set `false` to skip — you can rely on CI or `qualityGates` in the worktree instead.
   */
  runMainRepoVerificationBeforeSdlc: boolean;
  /** Shell command for pre-SDLC verification (default `npm run build`). Override with env `SDLC_VERIFY_COMMAND`. */
  mainRepoVerificationCommand: string;
  /**
   * After a **successful** `gh pr merge` (full SDLC or `--publish`), hard-reset local **`git.baseBranch`** to **`origin/<baseBranch>`**
   * so stray uncommitted files are discarded. Requires a **clean** tree when switching branches — skipped if dirty.
   */
  resetMainCheckoutAfterMerge: boolean;
  /**
   * Intended for **Cursor agent workflow** (optional `.cursor/hooks` + env): when you edit in the repo without running full SDLC,
   * see README “Agent edit → auto merge”. The hook is opt-in via **`SDLC_CURSOR_PUBLISH_ON_STOP=1`** in `.env`.
   */
  agentEditAutoPublish: boolean;
  /**
   * After **every** full SDLC run (success or failure), **`git fetch`**, **`checkout -f <baseBranch>`**, **`reset --hard origin/<baseBranch>`**
   * so local main matches GitHub and conflicts/dirty trees are cleared. Set **`SDLC_SKIP_ALIGN_MAIN_AFTER_RUN=1`** to skip.
   * Optional: **`SDLC_CLEAN_UNTRACKED_AFTER_ALIGN=1`** runs **`git clean -fd`** (removes untracked files — destructive).
   */
  alignMainWithRemoteAfterRun: boolean;
  /** `gh pr merge ... --auto` then poll until merged (see `git.mergeUseGhAuto` in sdlc.config.ts). */
  mergeUseGhAuto: boolean;
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
  fullAgentAutomation: false,
  requireHumanApprovalBeforeMerge: false,
  runMainRepoVerificationBeforeSdlc: false,
  mainRepoVerificationCommand: 'npm run build',
  resetMainCheckoutAfterMerge: false,
  agentEditAutoPublish: false,
  alignMainWithRemoteAfterRun: false,
  mergeUseGhAuto: true,
};

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/** Map nested `sdlc.features.json` keys → flat `SdlcFeatureFlags` keys. */
const NESTED_FEATURE_ALIASES: Record<string, keyof SdlcFeatureFlags> = {
  heroSkills: 'aiHeroSkills',
  review: 'aiReview',
  gatesInWorktree: 'qualityGates',
  verifyMainBeforeRun: 'runMainRepoVerificationBeforeSdlc',
  mainVerificationCommand: 'mainRepoVerificationCommand',
  pullMainBeforeRun: 'autoPullMainBeforeRun',
  pullMainAfterPr: 'autoPullMainAfterPr',
  pullMainAfterMerge: 'autoPullMainAfterMerge',
  localAfterMerge: 'autoDeployLocal',
};

function coerceBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

/**
 * Accepts flat legacy JSON or nested groups (`automation`, `ai`, `git`, …).
 */
export function normalizeFeatureFlagsJson(parsed: Record<string, unknown>): Partial<SdlcFeatureFlags> {
  const usesNested = FEATURE_GROUPS.some(g => g in parsed);
  if (!usesNested) {
    return parsed as Partial<SdlcFeatureFlags>;
  }

  const out: Partial<SdlcFeatureFlags> = {};

  const auto = parsed.automation;
  if (isPlainObject(auto)) {
    const f = coerceBool(auto.fullAgentAutomation);
    if (f !== undefined) out.fullAgentAutomation = f;
    const h = coerceBool(auto.requireHumanApprovalBeforeMerge);
    if (h !== undefined) out.requireHumanApprovalBeforeMerge = h;
  }

  const ai = parsed.ai;
  if (isPlainObject(ai)) {
    if (coerceBool(ai.autoImplement) !== undefined) out.autoImplement = coerceBool(ai.autoImplement);
    if (coerceBool(ai.heroSkills) !== undefined) out.aiHeroSkills = coerceBool(ai.heroSkills);
    if (coerceBool(ai.review) !== undefined) out.aiReview = coerceBool(ai.review);
    if (coerceBool(ai.commitMessageFromSkills) !== undefined) {
      out.autoCommitMessageFromSkills = coerceBool(ai.commitMessageFromSkills);
    }
  }

  const git = parsed.git;
  if (isPlainObject(git)) {
    const map: [string, keyof SdlcFeatureFlags][] = [
      ['isolatedWorktree', 'isolatedWorktree'],
      ['pruneStaleWorktreesOnStart', 'pruneStaleWorktreesOnStart'],
      ['syncUncommittedFromMain', 'syncUncommittedFromMain'],
      ['pullMainBeforeRun', 'autoPullMainBeforeRun'],
      ['pullMainAfterPr', 'autoPullMainAfterPr'],
      ['pullMainAfterMerge', 'autoPullMainAfterMerge'],
      ['resetMainCheckoutAfterMerge', 'resetMainCheckoutAfterMerge'],
      ['alignMainWithRemoteAfterRun', 'alignMainWithRemoteAfterRun'],
    ];
    for (const [from, to] of map) {
      const v = coerceBool(git[from]);
      if (v !== undefined) (out as Record<string, boolean>)[to] = v;
    }
  }

  const delivery = parsed.delivery;
  if (isPlainObject(delivery)) {
    for (const key of ['autoCommit', 'autoPush', 'autoPr', 'autoMerge', 'mergeUseGhAuto'] as const) {
      const v = coerceBool(delivery[key]);
      if (v !== undefined) out[key] = v;
    }
  }

  const quality = parsed.quality;
  if (isPlainObject(quality)) {
    const g = coerceBool(quality.gatesInWorktree);
    if (g !== undefined) out.qualityGates = g;
    const v = coerceBool(quality.verifyMainBeforeRun);
    if (v !== undefined) out.runMainRepoVerificationBeforeSdlc = v;
    if (typeof quality.mainVerificationCommand === 'string') {
      out.mainRepoVerificationCommand = quality.mainVerificationCommand;
    }
  }

  const deploy = parsed.deploy;
  if (isPlainObject(deploy)) {
    const l = coerceBool(deploy.localAfterMerge);
    if (l !== undefined) out.autoDeployLocal = l;
  }

  const integrations = parsed.integrations;
  if (isPlainObject(integrations)) {
    const cursor = integrations.cursor;
    if (isPlainObject(cursor)) {
      const a = coerceBool(cursor.agentEditAutoPublish);
      if (a !== undefined) out.agentEditAutoPublish = a;
    }
  }

  for (const [nestedKey, flatKey] of Object.entries(NESTED_FEATURE_ALIASES)) {
    if ((out as Record<string, unknown>)[flatKey] !== undefined) continue;
    for (const group of FEATURE_GROUPS) {
      const g = parsed[group];
      if (!isPlainObject(g) || !(nestedKey in g)) continue;
      const v = coerceBool(g[nestedKey]);
      if (v !== undefined) (out as Record<string, boolean>)[flatKey] = v;
    }
  }

  return out;
}

/**
 * Loads optional `sdlc.features.json` from the monorepo root (next to root package.json).
 */
export async function loadFeatureFlags(repoRoot: string): Promise<SdlcFeatureFlags> {
  const file = path.join(repoRoot, 'sdlc.features.json');
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const normalized = normalizeFeatureFlagsJson(parsed);
    return { ...defaultFlags, ...normalized };
  } catch {
    return { ...defaultFlags };
  }
}

/**
 * Apply feature toggles to a copy of `sdlcConfig` so `sdlc.config.ts` stays the structural default.
 */
export type SdlcConfigWithFeatures = SdlcConfig & { features: SdlcFeatureFlags; project: SdlcProjectProfile };

export function applyFeatureFlagsToConfig(base: SdlcConfig, f: SdlcFeatureFlags): SdlcConfigWithFeatures {
  const c = deepClone(base) as SdlcConfigWithFeatures;
  let flags = { ...f };
  if (flags.fullAgentAutomation) {
    flags = {
      ...flags,
      autoCommit: true,
      autoPush: true,
      autoPr: true,
      autoMerge: true,
      requireHumanApprovalBeforeMerge: false,
    };
  }
  c.features = flags;
  c.git.worktreesEnabled = flags.isolatedWorktree;
  c.git.pruneStaleWorktreesOnStart = flags.pruneStaleWorktreesOnStart;
  c.git.autoStage = flags.autoCommit;
  c.git.autoCommit = flags.autoCommit;
  c.git.autoPush = flags.autoPush;
  c.git.autoCreatePr = flags.autoPr;
  c.git.autoMerge = flags.autoMerge;
  c.git.mergeUseGhAuto = flags.mergeUseGhAuto;

  if (!flags.aiHeroSkills) {
    c.aiHero.discoveryEnabled = false;
    c.aiHero.selectionEnabled = false;
    c.aiHero.executionEnabled = false;
    c.aiHero.validationEnabled = false;
  }
  if (!flags.qualityGates) {
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
  const project = await loadProjectProfile(repoRoot);
  const withProject = applyProjectProfile(sdlcConfig, project);
  const merged = applyFeatureFlagsToConfig(withProject, flags);
  merged.project = project;
  return merged;
}
