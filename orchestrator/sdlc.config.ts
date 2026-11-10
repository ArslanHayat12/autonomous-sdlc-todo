/**
 * Single source of truth for the autonomous SDLC platform.
 * Credentials belong in environment variables only (OPENAI_API_KEY, GH_TOKEN, etc.).
 *
 * @see https://www.aihero.dev/
 * @see https://www.aihero.dev/skills
 * @see https://github.com/mattpocock/skills
 */

export type RetryPolicy = { maxAttempts: number; backoffMs: number };

export type AiProviderName = 'openai';

export type AiConfig = {
  provider: AiProviderName;
  /** Default model when env OPENAI_MODEL is unset */
  defaultModel: string;
  /** Additional models the router may consider */
  availableModels: string[];
  maxOutputTokens: number;
  implementationRetries: RetryPolicy;
  reviewRetries: RetryPolicy;
  requestTimeoutMs: number;
};

export type AiHeroSkillSource = {
  name: string;
  /** Local path under repo root (installed via npx skills or vendored) */
  skillsRoot: string;
  /** Official catalog URL for discovery metadata */
  catalogUrl: string;
  officialRepo: string;
};

export type AiHeroConfig = {
  documentationUrl: string;
  /** Run `npx skills@latest add mattpocock/skills` — may require network and user approval */
  installCommand: readonly string[];
  sources: AiHeroSkillSource[];
  /** Candidate skill ids to prefer when routing matches keywords */
  routingKeywords: Record<string, readonly string[]>;
  discoveryEnabled: boolean;
  selectionEnabled: boolean;
  executionEnabled: boolean;
  validationEnabled: boolean;
  /** When no SKILL.md matches, continue with AI-only review (never claim Hero ran) */
  fallbackToAiReview: boolean;
  trackVersions: boolean;
};

export type FeatureBranchNaming = 'semantic' | 'timestamp';

export type GitPolicy = {
  baseBranch: string;
  /** Legacy prefix when `featureBranchNaming` is `timestamp` (e.g. `sdlc/agent-`) */
  featureBranchPrefix: string;
  /**
   * `semantic` (default): `feat/short-slug-abc123` from the instruction.
   * `timestamp`: legacy `featureBranchPrefix` + ISO stamp.
   */
  featureBranchNaming: FeatureBranchNaming;
  /** Optional scope in semantic names → `feat/<scope>-slug-abc123` (omit for `feat/slug-abc123`) */
  featureBranchScope: string;
  worktreesEnabled: boolean;
  worktreesDirectory: string;
  autoStage: boolean;
  autoCommit: boolean;
  autoPush: boolean;
  autoCreatePr: boolean;
  autoMerge: boolean;
  /** When true, first run `gh pr merge ... --auto` (queue when branch protection blocks immediate merge). Env **`SDLC_MERGE_USE_AUTO`** overrides (`0`/`1`). */
  mergeUseGhAuto: boolean;
  mergeStrategy: 'squash' | 'merge' | 'rebase';
  cleanupFeatureBranchAfterMerge: boolean;
  /** Never run these destructive operations on the user's main checkout */
  forbidForcePush: true;
  /** Remove prior sdlc/* worktrees before creating a new one (frees disk from old runs) */
  pruneStaleWorktreesOnStart: boolean;
};

export type QualityGateId =
  | 'eslint'
  | 'typescript'
  | 'unit'
  | 'integration'
  | 'e2e'
  | 'build'
  | 'dependencyAudit'
  | 'sast'
  | 'dast'
  | 'dockerBuild'
  | 'dockerHealth';

export type GatePolicy = {
  enabled: boolean;
  /** mandatory blocks merge when failed or when enabled and error */
  mandatory: boolean;
  timeoutMs: number;
  retry: RetryPolicy;
};

export type QualityGatesConfig = Record<QualityGateId, GatePolicy>;

export type GitHubConfig = {
  prTitleTemplate: string;
  prBodyTemplate: string;
  labels: string[];
  /** Passed to gh pr create --label */
  autoLabel: boolean;
  /** Refresh PR body with live pipeline checklist + AI Hero skill table */
  prPipelineChecklist: boolean;
  /** Post a short PR comment when a pipeline step succeeds (can be noisy — default false) */
  prStepComments: boolean;
  /** Write `.sdlc/last-error.json` and comment on the PR when the run fails */
  notifyOnFailure: boolean;
  /** gh pr merge --admin is NEVER used */
  respectBranchProtection: true;
};

export type DockerConfig = {
  enabled: boolean;
  composeFile: string;
  buildServices: string[];
  upDetached: boolean;
  imageTagTemplate: string;
  healthUrls: { name: string; url: string }[];
  healthTimeoutMs: number;
  restartPolicy: string;
  rollbackOnFailedHealth: boolean;
  /** Production targets require explicit env */
  requireExplicitAuthForProduction: boolean;
};

export type WorkflowConfig = {
  maxAiReviewIterations: number;
  maxImplementationRetries: number;
  maxTestRetries: number;
  maxExecutionTimeMs: number;
  resumeEnabled: boolean;
  stateFile: string;
  reportDir: string;
  dryRun: boolean;
};

/** Continuous worker (polls GitHub issues + local queue). */
export type WorkerConfig = {
  enabled: boolean;
  pollingIntervalMs: number;
  /** Process at most this many tasks before exiting (0 = unlimited until SIGTERM). */
  maxConsecutiveTasks: number;
  /** Parallel task executions (1 recommended — each run holds git state). */
  concurrency: number;
  /** Optional separate git checkout for the worker (set **`SDLC_REPO_ROOT`**); keeps Cursor’s dirty tree untouched. */
  dedicatedRepoPath: string;
  /** When `dedicatedRepoPath` is set, mirror `syncPathsFromMain` + uncommitted files from **`SDLC_PRIMARY_REPO_ROOT`**. */
  syncFromPrimaryWorkspace: boolean;
  workerStateFile: string;
  shutdownFile: string;
  pidFile: string;
};

export type TaskSourcesConfig = {
  githubIssues: boolean;
  /** `gh issue list` label filter (comma-separated passed to `--label`) */
  githubIssueLabels: string;
  /** Max issues to fetch per poll */
  githubIssueLimit: number;
  localQueue: boolean;
  /** Relative to monorepo root */
  localQueueFile: string;
};

export type SafetyConfig = {
  maxTaskRetries: number;
  neverBypassBranchProtection: true;
  /** `git clean` is never run by this project */
  forbidGitClean: true;
};

export type SdlcConfig = {
  ai: AiConfig;
  aiHero: AiHeroConfig;
  git: GitPolicy;
  qualityGates: QualityGatesConfig;
  github: GitHubConfig;
  docker: DockerConfig;
  workflow: WorkflowConfig;
  worker: WorkerConfig;
  taskSources: TaskSourcesConfig;
  safety: SafetyConfig;
  /** Paths to mirror from main checkout into worktree (tests / config) */
  syncPathsFromMain: readonly string[];
};

const defaultRetry: RetryPolicy = { maxAttempts: 2, backoffMs: 2000 };

export const sdlcConfig: SdlcConfig = {
  ai: {
    provider: 'openai',
    defaultModel: 'gpt-4.1-mini',
    availableModels: ['gpt-4.1-mini', 'gpt-4.1'],
    maxOutputTokens: 8192,
    implementationRetries: { maxAttempts: 2, backoffMs: 3000 },
    reviewRetries: defaultRetry,
    requestTimeoutMs: 120_000,
  },
  aiHero: {
    documentationUrl: 'https://www.aihero.dev/',
    installCommand: ['npx', 'skills@latest', 'add', 'mattpocock/skills'] as const,
    sources: [
      {
        name: 'mattpocock-skills',
        skillsRoot: 'skills',
        catalogUrl: 'https://www.aihero.dev/skills',
        officialRepo: 'https://github.com/mattpocock/skills',
      },
    ],
    routingKeywords: {
      auth: ['api-security', 'typescript-strict'],
      test: ['playwright-testing'],
      react: ['react-accessibility', 'typescript-strict'],
      bug: ['diagnosing-bugs'],
      pr: ['pr'],
      architecture: ['improve-codebase-architecture'],
    },
    discoveryEnabled: true,
    selectionEnabled: true,
    executionEnabled: true,
    validationEnabled: true,
    fallbackToAiReview: true,
    trackVersions: true,
  },
  git: {
    baseBranch: 'main',
    featureBranchPrefix: 'sdlc/agent-',
    featureBranchNaming: 'semantic',
    featureBranchScope: '',
    worktreesEnabled: true,
    worktreesDirectory: '.sdlc-worktrees',
    autoStage: true,
    autoCommit: true,
    autoPush: true,
    autoCreatePr: true,
    autoMerge: true,
    mergeUseGhAuto: true,
    mergeStrategy: 'squash',
    cleanupFeatureBranchAfterMerge: true,
    forbidForcePush: true,
    pruneStaleWorktreesOnStart: true,
  },
  qualityGates: {
    eslint: { enabled: false, mandatory: false, timeoutMs: 120_000, retry: defaultRetry },
    typescript: { enabled: true, mandatory: true, timeoutMs: 180_000, retry: defaultRetry },
    unit: { enabled: false, mandatory: false, timeoutMs: 120_000, retry: defaultRetry },
    integration: { enabled: false, mandatory: false, timeoutMs: 180_000, retry: defaultRetry },
    e2e: { enabled: true, mandatory: true, timeoutMs: 300_000, retry: { maxAttempts: 2, backoffMs: 5000 } },
    build: { enabled: true, mandatory: true, timeoutMs: 300_000, retry: defaultRetry },
    dependencyAudit: { enabled: true, mandatory: true, timeoutMs: 120_000, retry: defaultRetry },
    sast: { enabled: false, mandatory: false, timeoutMs: 120_000, retry: defaultRetry },
    dast: { enabled: true, mandatory: false, timeoutMs: 60_000, retry: defaultRetry },
    dockerBuild: { enabled: true, mandatory: false, timeoutMs: 600_000, retry: { maxAttempts: 1, backoffMs: 0 } },
    dockerHealth: { enabled: true, mandatory: false, timeoutMs: 120_000, retry: defaultRetry },
  },
  github: {
    prTitleTemplate: 'feat(sdlc): {{instructionShort}}',
    prBodyTemplate: '',
    labels: ['sdlc', 'automation'],
    autoLabel: true,
    prPipelineChecklist: true,
    prStepComments: false,
    notifyOnFailure: true,
    respectBranchProtection: true,
  },
  docker: {
    enabled: true,
    composeFile: 'docker-compose.yml',
    buildServices: ['api'],
    upDetached: true,
    imageTagTemplate: '{{shortSha}}',
    healthUrls: [
      { name: 'api', url: 'http://127.0.0.1:4000/health' },
      { name: 'web', url: 'http://127.0.0.1:5173' },
    ],
    healthTimeoutMs: 120_000,
    restartPolicy: 'unless-stopped',
    rollbackOnFailedHealth: false,
    requireExplicitAuthForProduction: true,
  },
  workflow: {
    maxAiReviewIterations: 3,
    maxImplementationRetries: 2,
    maxTestRetries: 2,
    maxExecutionTimeMs: 45 * 60_000,
    resumeEnabled: true,
    stateFile: '.sdlc/workflow-state.json',
    reportDir: 'artifacts/sdlc-reports',
    dryRun: false,
  },
  worker: {
    enabled: true,
    pollingIntervalMs: 30_000,
    maxConsecutiveTasks: 0,
    concurrency: 1,
    dedicatedRepoPath: '',
    syncFromPrimaryWorkspace: true,
    workerStateFile: '.sdlc/worker-state.json',
    shutdownFile: '.sdlc/WORKER_SHUTDOWN',
    pidFile: '.sdlc/worker.pid',
  },
  taskSources: {
    githubIssues: true,
    githubIssueLabels: 'sdlc',
    githubIssueLimit: 20,
    localQueue: true,
    localQueueFile: 'tasks/queue.json',
  },
  safety: {
    maxTaskRetries: 2,
    neverBypassBranchProtection: true,
    forbidGitClean: true,
  },
  /** Overridden by `sdlc.project.json` → `syncPathsFromMain` when present. */
  syncPathsFromMain: [],
};
