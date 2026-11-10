import type { Request } from 'express';

/** Express 5 types allow `string | string[]` for route params — normalize to a single string. */
export function routeParam(req: Request, name: string): string | undefined {
  const raw = req.params[name];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw[0];
  return undefined;
}
