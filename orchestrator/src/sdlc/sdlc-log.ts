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
};

export type LogTone = 'info' | 'ok' | 'warn' | 'error' | 'skip';

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
  if (/\bpassed\b|\bmerged\b|\bsucceeded\b|\binstalled\b|\bcomplete\b|\bopened\b|\bcreated\b|\brebased\b/.test(d)) {
    return 'ok';
  }
  if (/\bwarn\b|caution/.test(d)) return 'warn';
  return 'info';
}

function toneColor(tone: LogTone): string {
  switch (tone) {
    case 'ok':
      return ANSI.green;
    case 'warn':
    case 'skip':
      return ANSI.yellow;
    case 'error':
      return ANSI.red;
    default:
      return ANSI.cyan;
  }
}

function bulletColor(tone: LogTone): string {
  switch (tone) {
    case 'ok':
      return ANSI.green;
    case 'error':
      return ANSI.red;
    case 'warn':
    case 'skip':
      return ANSI.yellow;
    default:
      return ANSI.blue;
  }
}

/**
 * Single pipeline step: colored bullet + plain line for reports.
 */
export function formatStepBullet(name: string, detail: string): { plain: string; line: string } {
  const ts = new Date().toISOString();
  const plain = `[${ts}] ${name}: ${detail}`;
  const tone = inferTone(detail);

  if (!colorsEnabled()) {
    return { plain, line: `  • ${name} — ${detail}` };
  }

  const b = bulletColor(tone);
  const nameStyled = `${ANSI.bold}${ANSI.cyan}${name}${ANSI.reset}`;
  const detailStyled = `${toneColor(tone)}${detail}${ANSI.reset}`;
  const line = `  ${b}•${ANSI.reset} ${nameStyled} ${ANSI.dim}—${ANSI.reset} ${detailStyled}`;
  return { plain, line };
}

export function logSection(title: string): void {
  if (!colorsEnabled()) {
    console.log(`\n${title}`);
    return;
  }
  console.log(`\n${ANSI.bold}${ANSI.magenta}▸ ${title}${ANSI.reset}`);
}

export function logRunSummary(items: { label: string; value: string; tone?: LogTone }[]): void {
  logSection('Run complete');
  for (const item of items) {
    const tone = item.tone ?? inferTone(item.value);
    if (!colorsEnabled()) {
      console.log(`  • ${item.label}: ${item.value}`);
      continue;
    }
    const b = bulletColor(tone);
    const val = `${toneColor(tone)}${item.value}${ANSI.reset}`;
    console.log(`  ${b}•${ANSI.reset} ${ANSI.dim}${item.label}:${ANSI.reset} ${val}`);
  }
  console.log('');
}

export function logWorkerBullet(message: string, tone: LogTone = 'info'): void {
  const ts = new Date().toISOString();
  if (!colorsEnabled()) {
    console.log(`  • [${ts}] worker — ${message}`);
    return;
  }
  const b = bulletColor(tone);
  console.log(
    `  ${b}•${ANSI.reset} ${ANSI.dim}[${ts}]${ANSI.reset} ${ANSI.cyan}worker${ANSI.reset} ${ANSI.dim}—${ANSI.reset} ${toneColor(tone)}${message}${ANSI.reset}`,
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
    out(`  ${ANSI.red}•${ANSI.reset} ${l}`);
  }
}
