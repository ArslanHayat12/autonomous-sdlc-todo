import type { GateResult } from './types.js';

export function mandatoryGatesFailed(gates: GateResult[]): boolean {
  return gates.some(g => g.mandatory && g.status === 'failed');
}

export function mandatoryGateFailureMessage(gates: GateResult[]): string {
  const bad = gates.filter(g => g.mandatory && g.status === 'failed');
  if (!bad.length) return '';
  return `Mandatory quality gates failed: ${bad.map(g => `${g.id} (${g.status})`).join(', ')}. Commit blocked.`;
}
