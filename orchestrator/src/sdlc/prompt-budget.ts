import type { AiConfig } from '../../sdlc.config.js';

export type PromptBudget = {
  maxCharsPerFile: number;
  maxCharsPerSkill: number;
  maxSkillsInPrompt: number;
  reviewPreferGitDiff: boolean;
  maxBuildFeedbackChars: number;
};

const DEFAULT_BUDGET: PromptBudget = {
  maxCharsPerFile: 24_000,
  maxCharsPerSkill: 2_500,
  maxSkillsInPrompt: 3,
  reviewPreferGitDiff: true,
  maxBuildFeedbackChars: 3_500,
};

const COMPACT_BUDGET: PromptBudget = {
  maxCharsPerFile: 10_000,
  maxCharsPerSkill: 1_200,
  maxSkillsInPrompt: 2,
  reviewPreferGitDiff: true,
  maxBuildFeedbackChars: 2_000,
};

function envInt(name: string, fallback: number): number {
  const v = process.env[name]?.trim();
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Resolved per run — env overrides > compact mode > sdlc.config defaults. */
export function resolvePromptBudget(ai: AiConfig, compactPrompts: boolean): PromptBudget {
  const base = compactPrompts ? COMPACT_BUDGET : DEFAULT_BUDGET;
  const cfg = ai.promptBudget;
  const fromCfg = compactPrompts
    ? base
    : {
        maxCharsPerFile: cfg?.maxCharsPerFile ?? DEFAULT_BUDGET.maxCharsPerFile,
        maxCharsPerSkill: cfg?.maxCharsPerSkill ?? DEFAULT_BUDGET.maxCharsPerSkill,
        maxSkillsInPrompt: cfg?.maxSkillsInPrompt ?? DEFAULT_BUDGET.maxSkillsInPrompt,
        reviewPreferGitDiff: cfg?.reviewPreferGitDiff ?? DEFAULT_BUDGET.reviewPreferGitDiff,
        maxBuildFeedbackChars: cfg?.maxBuildFeedbackChars ?? DEFAULT_BUDGET.maxBuildFeedbackChars,
      };
  return {
    maxCharsPerFile: envInt('SDLC_MAX_CHARS_PER_FILE', fromCfg.maxCharsPerFile),
    maxCharsPerSkill: envInt('SDLC_MAX_CHARS_PER_SKILL', fromCfg.maxCharsPerSkill),
    maxSkillsInPrompt: envInt('SDLC_MAX_SKILLS_IN_PROMPT', fromCfg.maxSkillsInPrompt),
    reviewPreferGitDiff:
      process.env.SDLC_REVIEW_FULL_FILES === '1'
        ? false
        : process.env.SDLC_REVIEW_GIT_DIFF === '0'
          ? false
          : fromCfg.reviewPreferGitDiff,
    maxBuildFeedbackChars: envInt('SDLC_MAX_BUILD_FEEDBACK_CHARS', fromCfg.maxBuildFeedbackChars),
  };
}

export function truncateForPrompt(text: string, max: number, label = 'content'): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n\n… [${label} truncated — ${t.length - max} chars omitted] …`;
}
