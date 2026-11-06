export type CliMode = 'full' | 'resume' | 'status' | 'dryRun' | 'reviewOnly' | 'deployOnly';

export type ParsedArgv = {
  mode: CliMode;
  instruction: string;
};

const FLAGS = new Set(['--resume', '--status', '--dry-run', '--review-only', '--deploy-only']);

export function parseArgv(argv: string[]): ParsedArgv {
  const tokens = [...argv];
  let mode: CliMode = 'full';
  for (const f of FLAGS) {
    const i = tokens.indexOf(f);
    if (i !== -1) {
      tokens.splice(i, 1);
      if (f === '--resume') mode = 'resume';
      else if (f === '--status') mode = 'status';
      else if (f === '--dry-run') mode = 'dryRun';
      else if (f === '--review-only') mode = 'reviewOnly';
      else if (f === '--deploy-only') mode = 'deployOnly';
    }
  }
  const instruction = tokens.join(' ').trim() || 'Analyze the Todo app and propose one small, safe improvement.';
  return { mode, instruction };
}
