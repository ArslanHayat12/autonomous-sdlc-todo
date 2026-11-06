import OpenAI from 'openai';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const reportDir = path.join(root, 'artifacts');
const instruction = process.argv.slice(2).join(' ').trim() || 'Analyze the Todo app and propose one small, safe improvement. Do not change code without a concrete implementation plan.';
const run = (command: string, args: string[], allowFailure = false) => {
  try { return execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { if (allowFailure) return String((error as Error).message); throw error; }
};
const log: string[] = [];
const step = (name: string, detail: string) => { const line = `[${new Date().toISOString()}] ${name}: ${detail}`; log.push(line); console.log(line); };

async function main() {
  await mkdir(reportDir, { recursive: true });
  step('instruction', instruction);
  const status = run('git', ['status', '--short'], true);
  if (status.trim()) throw new Error('Working tree is not clean. Commit or stash existing changes before running the agent.');
  const branch = `agent/${new Date().toISOString().replace(/[:.]/g, '-')}`;
  run('git', ['switch', '-c', branch]);
  step('repository analysis', 'Captured git status and project manifest.');
  const packageJson = await readFile(path.join(root, 'package.json'), 'utf8');
  const plan = `Instruction:\n${instruction}\n\nRepository package manifest:\n${packageJson}\n\nSelect relevant skills from: repository-analysis, typescript-clean-code, react-accessibility, api-security, playwright-testing, dependency-security, docker-build.\nReturn: (1) selected skills, (2) risk assessment, (3) implementation plan. Do not claim tools/tests ran unless evidence is provided.`;
  let aiPlan = 'OPENAI_API_KEY not configured. Skipping AI planning; local validation will still run.';
  if (process.env.OPENAI_API_KEY) {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({ model: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini', input: plan });
    aiPlan = response.output_text || 'No plan returned.';
  }
  await writeFile(path.join(reportDir, 'plan.md'), `# SDLC plan\n\n${aiPlan}\n`);
  step('skill selection', 'AI-selected skills are documented in artifacts/plan.md (or skipped without a key).');
  step('implementation', 'This starter does not let an LLM write arbitrary files by default. Apply approved changes in your editor, then rerun for validation.');
  const build = run('npm', ['run', 'build'], true);
  step('build', build.slice(-3000));
  const security = run('npm', ['audit', '--audit-level=high'], true);
  step('dependency security', security.slice(-3000));
  const reviewPrompt = `Independently review this change report. Be strict. Identify correctness, security, test coverage, and maintainability risks.\nInstruction: ${instruction}\nBuild output:\n${build}\nDependency audit output:\n${security}`;
  let review = 'AI review skipped: OPENAI_API_KEY not configured.';
  if (process.env.OPENAI_API_KEY) {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({ model: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini', input: reviewPrompt });
    review = response.output_text || 'No review returned.';
  }
  await writeFile(path.join(reportDir, 'review.md'), `# Independent review\n\n${review}\n`);
  step('independent review', 'Review saved to artifacts/review.md.');
  const testOutput = run('npx', ['playwright', 'test'], true);
  step('playwright', testOutput.slice(-3000));
  await writeFile(path.join(reportDir, 'run-report.md'), `# Run report\n\n- Branch: \`${branch}\`\n- Instruction: ${instruction}\n- Build: ${build.includes('error TS') ? 'FAILED' : 'Executed; inspect output below'}\n- Security: inspect audit output below\n- Playwright: inspect test output below\n\n## Log\n\n${log.join('\n')}\n\n## Build output\n\n\`\`\`\n${build}\n\`\`\`\n\n## Security output\n\n\`\`\`\n${security}\n\`\`\`\n\n## Playwright output\n\n\`\`\`\n${testOutput}\n\`\`\`\n`);
  step('git', 'Creating a local commit only if tracked changes exist.');
  const diff = run('git', ['status', '--short']);
  if (diff.trim()) { run('git', ['add', 'artifacts']); run('git', ['commit', '-m', 'chore: add autonomous SDLC run report']); }
  else step('git commit', 'No tracked changes to commit.');
  step('PR preparation', 'No remote publish configured. Add GitHub token and repo settings to enable a later publishing adapter.');
  step('Docker', 'Run docker compose build/up separately; deployment is not automatic.');
  step('approval gate', `DEPLOY_APPROVED=${process.env.DEPLOY_APPROVED ?? 'false'}; this starter never deploys automatically.`);
  console.log(`\nFinished. Branch: ${branch}\nReport: artifacts/run-report.md`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
