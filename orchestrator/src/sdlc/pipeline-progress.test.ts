import test from 'node:test';
import assert from 'node:assert/strict';
import { PipelineProgress } from './pipeline-progress.js';
import { buildSdlcPrBody } from './pr-body-builder.js';

test('PipelineProgress marks steps with checkboxes', () => {
  const p = new PipelineProgress('full');
  p.mark('worktree', 'succeeded', 'sdlc/feature-x');
  p.mark('skills', 'succeeded', 'react-accessibility');
  const md = p.checklistMarkdown();
  assert.match(md, /✅ \*\*Git worktree/);
  assert.match(md, /- \[x\].*AI Hero skill/);
});

test('buildSdlcPrBody lists Hero skills prominently', () => {
  const p = new PipelineProgress('full');
  p.mark('skills', 'succeeded', 'typescript-strict');
  const body = buildSdlcPrBody({
    instruction: 'Add filters',
    mode: 'full',
    progress: p,
    selectedSkillIds: ['typescript-strict', 'react-accessibility'],
    skillInvocations: [
      {
        skillId: 'typescript-strict',
        ran: true,
        mechanism: 'prompt',
        evidence: 'SKILL.md present',
      },
    ],
    commitSkillRecords: [
      {
        sha: 'abc1234567890',
        shortSha: 'abc1234',
        subject: 'feat(sdlc): refactor todos',
        role: 'implementation',
        skillIds: ['typescript-strict', 'react-accessibility'],
      },
    ],
    implementationSummary: 'Refactored todos API',
    gateResults: [{ id: 'build', status: 'passed', durationMs: 1, output: '', mandatory: true }],
    changedFiles: ['apps/web/src/App.tsx'],
  });
  assert.match(body, /## AI Hero skills \(this run\)/);
  assert.match(body, /## AI Hero skills per commit/);
  assert.match(body, /`typescript-strict`/);
  assert.match(body, /Implementation \(\+ commit message when enabled\)/);
  assert.match(body, /## Pipeline progress/);
});
