import type { QualityGateId } from '../../sdlc.config.js';

export type GateResult = {
  id: QualityGateId;
  status: 'passed' | 'failed' | 'skipped' | 'error';
  durationMs: number;
  output: string;
  mandatory: boolean;
};

export type SkillInvocation = {
  skillId: string;
  ran: boolean;
  /** How the skill was invoked (file-based prompt, CLI, etc.) */
  mechanism: string;
  evidence: string;
};

export type WorkflowState = {
  version: 1;
  startedAt: string;
  instruction: string;
  featureBranch?: string;
  baseSha?: string;
  prUrl?: string | null;
  prNumber?: number | null;
  commitSha?: string;
  mergeAttempted?: boolean;
  mergeSucceeded?: boolean;
  deployAttempted?: boolean;
  dockerImageTag?: string;
  phase: 'plan' | 'implement' | 'validate' | 'pr' | 'review' | 'merge' | 'deploy' | 'done' | 'failed';
};

export type ExecutionReport = {
  originalBranch: string;
  featureBranch: string;
  baseSha: string;
  selectedSkills: string[];
  skillInvocations: SkillInvocation[];
  implementationSummary: string;
  filesChanged: string[];
  commitSha: string;
  commitMessage: string;
  prUrl: string | null;
  reviewFindings: string;
  gateResults: GateResult[];
  mergeStatus: string;
  dockerImageTag?: string;
  deploymentStatus: string;
  healthResults: { name: string; ok: boolean; detail: string }[];
  rollbackStatus?: string;
};
