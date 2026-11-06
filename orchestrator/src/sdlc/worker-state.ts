import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { WorkerStateV1 } from './task-types.js';

export async function loadWorkerState(absPath: string): Promise<WorkerStateV1 | null> {
  try {
    const raw = await readFile(absPath, 'utf8');
    return JSON.parse(raw) as WorkerStateV1;
  } catch {
    return null;
  }
}

export async function saveWorkerState(absPath: string, state: WorkerStateV1): Promise<void> {
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, JSON.stringify(state, null, 2), 'utf8');
}

export async function removePidFile(absPath: string): Promise<void> {
  try {
    await unlink(absPath);
  } catch {
    /* ok */
  }
}

export function workerStatePath(repoRoot: string, rel: string): string {
  return path.join(repoRoot, rel);
}
