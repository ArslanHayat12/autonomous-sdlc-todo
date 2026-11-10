import process from 'node:process';

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  /** 256-color accents (distinct from basic 16) */
  orange: '\x1b[38;5;214m',
  purple: '\x1b[38;5;141m',
  teal: '\x1b[38;5;45m',
  pink: '\x1b[38;5;213m',
  lime: '\x1b[38;5;118m',
  gray: '\x1b[38;5;245m',
};

export type LogTone = 'info' | 'ok' | 'warn' | 'error' | 'skip';

export type StepCategory = 'instruction' | 'git' | 'github' | 'ai' | 'quality' | 'report' | 'default';

export function colorsEnabled(): boolean {
  if (process.env.NO_COLOR === '1' || process.env.SDLC_NO_COLOR === '1') return false;
  if (process.env.FORCE_COLOR === '1' || process.env.SDLC_FORCE_COLOR === '1') return true;
  return Boolean(process.stdout.isTTY);
}

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function inferTone(detail: string): LogTone {
  const d = detail.toLowerCase();
  if (/\bfailed\b|\berror\b|\babort|\bcould not\b|\bfatal\b/.test(d)) return 'error';
  if (/\bskipped\b|skip:|not attempted/.test(d)) return 'skip';
  if (/\bpassed\b|\bmerged\b|\bsucceeded\b|\binstalled\b|\bcomplete\b|\bopened\b|\bcreated\b|\brebased\b|\bready\b/.test(d)) {
    return 'ok';
  }
  if (/\bwarn\b|caution/.test(d)) return 'warn';
  return 'info';
}

export function categoryFromStepName(name: string): StepCategory {
  const n = name.toLowerCase();
  if (n === 'instruction' || n === 'mode') return 'instruction';
  if (n.includes('github') || n === 'pr' || n.includes('label')) return 'github';
  if (
    n.startsWith('git') ||
    n.includes('worktree') ||
    n.includes('branch') ||
    n.includes('sync') ||
    n.includes('align') ||
    n.includes('pull') ||
    n.includes('reset') ||
    n === 'install' ||
    n === 'publish'
  ) {
    return 'git';
  }
  if (
    n.includes('openai') ||
    n.includes('implement') ||
    n.includes('plan') ||
    n.startsWith('ai ') ||
    n.includes('hero') ||
    n.includes('commit message') ||
    n.includes('skills') ||
    n.includes('review')
  ) {
    return 'ai';
  }
  if (
    n.includes('quality') ||
    n.includes('gate') ||
    n.includes('verify') ||
    n.includes('build') ||
    n.includes('e2e') ||
    n.includes('deploy') ||
    n.includes('docker')
  ) {
    return 'quality';
  }
  if (n === 'report') return 'report';
  return 'default';
}

function categoryStyles(cat: StepCategory): { name: string; bullet: string } {
  switch (cat) {
    case 'instruction':
      return { name: ANSI.teal, bullet: ANSI.teal };
    case 'git':
      return { name: ANSI.blue, bullet: ANSI.blue };
    case 'github':
      return { name: ANSI.magenta, bullet: ANSI.pink };
    case 'ai':
      return { name: ANSI.purple, bullet: ANSI.purple };
    case 'quality':
      return { name: ANSI.orange, bullet: ANSI.orange };
    case 'report':
      return { name: ANSI.gray, bullet: ANSI.gray };
    default:
      return { name: ANSI.cyan, bullet: ANSI.cyan };
  }
}

function toneColor(tone: LogTone): string {
  switch (tone) {
    case 'ok':
      return ANSI.lime;
    case 'warn':
      return ANSI.yellow;
    case 'skip':
      return ANSI.gray;
    case 'error':
      return ANSI.red;
    default:
      return '';
  }
}

function bulletForTone(tone: LogTone, categoryBullet: string): string {
  if (tone === 'error') return ANSI.red;
  if (tone === 'ok') return ANSI.green;
  if (tone === 'skip' || tone === 'warn') return ANSI.yellow;
  return categoryBullet;
}

/**
 * Single pipeline step: category-colored label + tone-colored detail.
 */
export function formatStepBullet(name: string, detail: string): { plain: string; line: string } {
  const ts = new Date().toISOString();
  const plain = `[${ts}] ${name}: ${detail}`;
  const tone = inferTone(detail);
  const cat = categoryFromStepName(name);

  if (!colorsEnabled()) {
    return { plain, line: `  • ${name} — ${detail}` };
  }

  const { name: nameColor, bullet: catBullet } = categoryStyles(cat);
  const b = bulletForTone(tone, catBullet);
  const nameStyled = `${ANSI.bold}${nameColor}${name}${ANSI.reset}`;
  const detailColor = toneColor(tone);
  const detailStyled = detailColor ? `${detailColor}${detail}${ANSI.reset}` : detail;
  const line = `  ${b}•${ANSI.reset} ${nameStyled} ${ANSI.dim}—${ANSI.reset} ${detailStyled}`;
  return { plain, line };
}

const SECTION_COLORS: Record<string, string> = {
  'SDLC pipeline': ANSI.teal,
  'SDLC worker': ANSI.purple,
  'Run complete': ANSI.lime,
};

export function logSection(title: string): void {
  if (!colorsEnabled()) {
    console.log(`\n${title}`);
    return;
  }
  const accent = SECTION_COLORS[title] ?? ANSI.magenta;
  console.log(`\n${ANSI.bold}${accent}▸ ${title}${ANSI.reset}`);
}

const SUMMARY_LABEL_COLORS: Record<string, string> = {
  Mode: ANSI.gray,
  Report: ANSI.blue,
  PR: ANSI.magenta,
  Merge: ANSI.green,
  Deploy: ANSI.orange,
};

export function logRunSummary(items: { label: string; value: string; tone?: LogTone }[]): void {
  logSection('Run complete');
  for (const item of items) {
    const tone = item.tone ?? inferTone(item.value);
    if (!colorsEnabled()) {
      console.log(`  • ${item.label}: ${item.value}`);
      continue;
    }
    const labelColor = SUMMARY_LABEL_COLORS[item.label] ?? ANSI.cyan;
    const b = bulletForTone(tone, labelColor);
    const valColor = toneColor(tone) || labelColor;
    const val = `${valColor}${item.value}${ANSI.reset}`;
    console.log(
      `  ${b}•${ANSI.reset} ${ANSI.bold}${labelColor}${item.label}${ANSI.reset}${ANSI.dim}:${ANSI.reset} ${val}`,
    );
  }
  console.log('');
}

export function logWorkerBullet(message: string, tone: LogTone = 'info'): void {
  const ts = new Date().toISOString();
  if (!colorsEnabled()) {
    console.log(`  • [${ts}] worker — ${message}`);
    return;
  }
  const b = bulletForTone(tone, ANSI.purple);
  console.log(
    `  ${b}•${ANSI.reset} ${ANSI.dim}[${ts}]${ANSI.reset} ${ANSI.bold}${ANSI.purple}worker${ANSI.reset} ${ANSI.dim}—${ANSI.reset} ${toneColor(tone) || ANSI.cyan}${message}${ANSI.reset}`,
  );
}

export function logErrorBlock(title: string, lines: string[]): void {
  const out = (s: string) => console.error(s);
  if (!colorsEnabled()) {
    out(`\n• ${title}`);
    for (const l of lines) out(`  • ${l}`);
    return;
  }
  out(`\n${ANSI.bold}${ANSI.red}✖ ${title}${ANSI.reset}`);
  for (const l of lines) {
    out(`  ${ANSI.red}•${ANSI.reset} ${ANSI.yellow}${l}${ANSI.reset}`);
  }
}
