export type ReviewFinding = {
  severity: 'critical' | 'high' | 'medium' | 'low';
  file: string;
  issue: string;
  fix: string;
};

export type ReviewResult = {
  findings: ReviewFinding[];
  needsMoreChanges: boolean;
  /** optional JSON patches same format as implementation */
  patches?: { path: string; content: string }[];
};

export function parseReviewJson(raw: string, jsonExtract: (s: string) => unknown): ReviewResult {
  const data = jsonExtract(raw);
  if (typeof data !== 'object' || data === null) throw new Error('Review JSON must be an object.');
  const r = data as Record<string, unknown>;
  const findingsRaw = r.findings;
  const findings: ReviewFinding[] = [];
  if (Array.isArray(findingsRaw)) {
    for (const f of findingsRaw) {
      if (typeof f !== 'object' || f === null) continue;
      const o = f as Record<string, unknown>;
      const severity = o.severity;
      if (severity !== 'critical' && severity !== 'high' && severity !== 'medium' && severity !== 'low') continue;
      if (typeof o.file !== 'string' || typeof o.issue !== 'string' || typeof o.fix !== 'string') continue;
      findings.push({ severity, file: o.file, issue: o.issue, fix: o.fix });
    }
  }
  const needsMoreChanges = Boolean(r.needsMoreChanges);
  const patchesRaw = r.patches;
  const patches: { path: string; content: string }[] = [];
  if (Array.isArray(patchesRaw)) {
    for (const p of patchesRaw) {
      if (typeof p !== 'object' || p === null) continue;
      const o = p as Record<string, unknown>;
      if (typeof o.path !== 'string' || typeof o.content !== 'string') continue;
      patches.push({ path: o.path.replace(/^\//, ''), content: o.content });
    }
  }
  return { findings, needsMoreChanges, patches: patches.length ? patches : undefined };
}
