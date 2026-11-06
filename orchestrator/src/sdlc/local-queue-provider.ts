import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { QueueFileV1, TaskRecord } from './task-types.js';

export async function loadQueueFile(absPath: string): Promise<QueueFileV1> {
  try {
    const raw = await readFile(absPath, 'utf8');
    const p = JSON.parse(raw) as QueueFileV1;
    if (p?.version === 1 && Array.isArray(p.tasks)) return p;
  } catch {
    /* missing */
  }
  return { version: 1, tasks: [] };
}

export async function saveQueueFile(absPath: string, data: QueueFileV1): Promise<void> {
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, JSON.stringify(data, null, 2), 'utf8');
}

export async function appendLocalTask(
  absPath: string,
  instruction: string,
  title?: string,
): Promise<TaskRecord> {
  const q = await loadQueueFile(absPath);
  const now = new Date().toISOString();
  const t: TaskRecord = {
    id: `local:${randomUUID()}`,
    source: 'local',
    title: title ?? instruction.slice(0, 120),
    body: instruction,
    instruction,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    attempts: 0,
  };
  q.tasks.push(t);
  await saveQueueFile(absPath, q);
  return t;
}
