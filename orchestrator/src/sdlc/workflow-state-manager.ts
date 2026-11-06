import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { WorkflowState } from './types.js';

export class WorkflowStateManager {
  constructor(private readonly repoRoot: string) {}

  statePath(relFromConfig: string): string {
    return path.join(this.repoRoot, relFromConfig);
  }

  async load(relPath: string): Promise<WorkflowState | null> {
    try {
      const raw = await readFile(this.statePath(relPath), 'utf8');
      return JSON.parse(raw) as WorkflowState;
    } catch {
      return null;
    }
  }

  async save(relPath: string, state: WorkflowState): Promise<void> {
    const p = this.statePath(relPath);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify(state, null, 2), 'utf8');
  }
}
