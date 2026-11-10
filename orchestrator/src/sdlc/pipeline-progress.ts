export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

export type PipelineStep = {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
  finishedAt?: string;
};

const FULL_PIPELINE_STEPS: { id: string; label: string }[] = [
  { id: 'worktree', label: 'Git worktree / feature branch' },
  { id: 'sync', label: 'Sync paths from main checkout' },
  { id: 'skills', label: 'AI Hero skill discovery & routing' },
  { id: 'plan', label: 'Implementation plan (OpenAI)' },
  { id: 'implement', label: 'Code implementation' },
  { id: 'validate', label: 'Quality gates (build, audit, e2e, …)' },
  { id: 'commit', label: 'Git commit (conventional message)' },
  { id: 'push', label: 'Git push to origin' },
  { id: 'pr', label: 'Pull request opened' },
  { id: 'review', label: 'AI Hero code review' },
  { id: 'pre-merge-sync', label: 'Rebase onto base branch (pre-merge)' },
  { id: 'merge', label: 'Merge via gh (squash / auto queue)' },
  { id: 'deploy', label: 'Local Docker deploy (optional)' },
];

const PUBLISH_PIPELINE_STEPS: { id: string; label: string }[] = [
  { id: 'commit', label: 'Git commit (publish mode)' },
  { id: 'validate', label: 'Quality gates' },
  { id: 'pr', label: 'Pull request opened' },
  { id: 'pre-merge-sync', label: 'Rebase onto base branch (pre-merge)' },
  { id: 'merge', label: 'Merge via gh' },
];

function tick(status: StepStatus): string {
  switch (status) {
    case 'succeeded':
      return '✅';
    case 'failed':
      return '❌';
    case 'skipped':
      return '⏭️';
    case 'running':
      return '🔄';
    default:
      return '⬜';
  }
}

function checkbox(status: StepStatus): string {
  if (status === 'succeeded' || status === 'skipped') return '- [x]';
  return '- [ ]';
}

export class PipelineProgress {
  private readonly steps: PipelineStep[];

  constructor(mode: 'full' | 'publish' = 'full') {
    const defs = mode === 'publish' ? PUBLISH_PIPELINE_STEPS : FULL_PIPELINE_STEPS;
    this.steps = defs.map(d => ({ ...d, status: 'pending' as const }));
  }

  getStep(id: string): PipelineStep | undefined {
    return this.steps.find(s => s.id === id);
  }

  markRunning(id: string, detail?: string): void {
    const s = this.steps.find(x => x.id === id);
    if (!s) return;
    s.status = 'running';
    if (detail) s.detail = detail;
  }

  mark(id: string, status: Exclude<StepStatus, 'running' | 'pending'>, detail?: string): void {
    const s = this.steps.find(x => x.id === id);
    if (!s) return;
    s.status = status;
    if (detail !== undefined) s.detail = detail;
    s.finishedAt = new Date().toISOString();
  }

  checklistMarkdown(): string {
    return this.steps
      .map(s => {
        const detail = s.detail ? ` — ${s.detail}` : '';
        return `${checkbox(s.status)} ${tick(s.status)} **${s.label}**${detail}`;
      })
      .join('\n');
  }

  failedSteps(): PipelineStep[] {
    return this.steps.filter(s => s.status === 'failed');
  }
}
