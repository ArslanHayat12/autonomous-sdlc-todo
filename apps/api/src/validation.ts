import { TITLE_MAX_LENGTH } from './types.js';

export function parseTitle(value: unknown): { ok: true; title: string } | { ok: false; error: string } {
  const title = typeof value === 'string' ? value.trim() : '';
  if (!title) {
    return { ok: false, error: 'Title is required' };
  }
  if (title.length > TITLE_MAX_LENGTH) {
    return { ok: false, error: `Title must be ${TITLE_MAX_LENGTH} characters or fewer` };
  }
  return { ok: true, title };
}
