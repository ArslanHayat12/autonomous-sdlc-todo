/** Unified task id: `gh:123` or `local:<uuid>` */
export type TaskId = string;

export type TaskSource = 'github' | 'local';

export type TaskRecord = {
  id: TaskId;
  source: TaskSource;
  /** GitHub issue number when source is github */
  issueNumber?: number;
  title: string;
  body: string;
  instruction: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'blocked';
  createdAt: string;
  updatedAt: string;
  attempts: number;
  lastError?: string;
  prUrl?: string | null;
  prNumber?: number | null;
  mergeStatus?: string;
};

export type QueueFileV1 = {
  version: 1;
  tasks: TaskRecord[];
};

export type WorkerProcessing = {
  taskId: TaskId;
  startedAt: string;
  /** Optional issue number for GitHub tasks */
  issueNumber?: number;
};

export type WorkerStateV1 = {
  version: 1;
  startedAt: string;
  updatedAt: string;
  pid: number;
  processing: WorkerProcessing | null;
  completedCount: number;
  lastTaskId?: TaskId;
  lastError?: string;
  shutdownRequested?: boolean;
  /** GitHub issue numbers skipped until worker state is cleared (merge/policy blocked). */
  blockedGithubIssueNumbers?: number[];
};
