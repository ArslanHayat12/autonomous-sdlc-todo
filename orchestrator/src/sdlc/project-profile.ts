import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { SdlcConfig } from '../../sdlc.config.js';

export type ProjectCommands = {
  install: string;
  build: string;
  /** Empty string disables the security gate command (falls back to npm audit). */
  security: string;
  /** Empty string skips e2e command. */
  e2e: string;
};

export type DastCheck = { url: string; method?: 'GET' | 'HEAD' };

export type SdlcProjectProfile = {
  name: string;
  implementationPaths: string[];
  reviewPaths: string[];
  syncPathsFromMain: string[];
  commitMessageComponents: string[];
  commands: ProjectCommands;
  dast: { enabled: boolean; checks: DastCheck[] };
  docker: { enabled: boolean; healthUrls: { name: string; url: string }[] };
};

export const defaultProjectProfile: SdlcProjectProfile = {
  name: 'project',
  implementationPaths: [
    'src/index.ts',
    'src/index.tsx',
    'src/main.ts',
    'src/main.tsx',
    'app/page.tsx',
    'app/layout.tsx',
    'lib/index.ts',
  ],
  reviewPaths: [],
  syncPathsFromMain: [],
  commitMessageComponents: [],
  commands: {
    install: 'npm install',
    build: 'npm run build',
    security: 'npm audit --audit-level=high',
    e2e: '',
  },
  dast: { enabled: false, checks: [] },
  docker: { enabled: false, healthUrls: [] },
};

function mergeProfile(parsed: Record<string, unknown>): SdlcProjectProfile {
  const base = defaultProjectProfile;
  const meta = (parsed.meta ?? {}) as Record<string, unknown>;
  const paths = (parsed.paths ?? {}) as Record<string, unknown>;
  const cmd = (parsed.commands ?? {}) as Record<string, unknown>;
  const dast = (parsed.dast ?? {}) as Record<string, unknown>;
  const docker = (parsed.docker ?? {}) as Record<string, unknown>;

  const name =
    typeof meta.name === 'string' ? meta.name : typeof parsed.name === 'string' ? parsed.name : base.name;

  const implementationPaths = Array.isArray(paths.implementation)
    ? (paths.implementation as string[])
    : Array.isArray(parsed.implementationPaths)
      ? (parsed.implementationPaths as string[])
      : base.implementationPaths;

  const reviewPaths = Array.isArray(paths.review)
    ? (paths.review as string[])
    : Array.isArray(parsed.reviewPaths)
      ? (parsed.reviewPaths as string[])
      : base.reviewPaths;

  const syncPathsFromMain = Array.isArray(paths.syncFromMainCheckout)
    ? (paths.syncFromMainCheckout as string[])
    : Array.isArray(parsed.syncPathsFromMain)
      ? (parsed.syncPathsFromMain as string[])
      : base.syncPathsFromMain;

  const commitMessageComponents = Array.isArray(paths.commitMessageComponents)
    ? (paths.commitMessageComponents as string[])
    : Array.isArray(parsed.commitMessageComponents)
      ? (parsed.commitMessageComponents as string[])
      : base.commitMessageComponents;

  return {
    name,
    implementationPaths,
    reviewPaths,
    syncPathsFromMain,
    commitMessageComponents,
    commands: {
      install: typeof cmd.install === 'string' ? cmd.install : base.commands.install,
      build: typeof cmd.build === 'string' ? cmd.build : base.commands.build,
      security: typeof cmd.security === 'string' ? cmd.security : base.commands.security,
      e2e: typeof cmd.e2e === 'string' ? cmd.e2e : base.commands.e2e,
    },
    dast: {
      enabled: typeof dast.enabled === 'boolean' ? dast.enabled : base.dast.enabled,
      checks: Array.isArray(dast.checks) ? (dast.checks as DastCheck[]) : base.dast.checks,
    },
    docker: {
      enabled: typeof docker.enabled === 'boolean' ? docker.enabled : base.docker.enabled,
      healthUrls: Array.isArray(docker.healthUrls)
        ? (docker.healthUrls as { name: string; url: string }[])
        : base.docker.healthUrls,
    },
  };
}

export async function loadProjectProfile(repoRoot: string): Promise<SdlcProjectProfile> {
  const file = path.join(repoRoot, 'sdlc.project.json');
  try {
    const raw = await readFile(file, 'utf8');
    return mergeProfile(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return { ...defaultProjectProfile };
  }
}

export function resolveImplementationPaths(profile: SdlcProjectProfile): string[] {
  return profile.implementationPaths.length ? profile.implementationPaths : defaultProjectProfile.implementationPaths;
}

export function resolveReviewPaths(profile: SdlcProjectProfile): string[] {
  return profile.reviewPaths.length ? profile.reviewPaths : profile.implementationPaths;
}

export function applyProjectProfile(base: SdlcConfig, profile: SdlcProjectProfile): SdlcConfig {
  const c = JSON.parse(JSON.stringify(base)) as SdlcConfig;
  if (profile.syncPathsFromMain.length) {
    c.syncPathsFromMain = profile.syncPathsFromMain;
  }
  if (profile.docker.healthUrls.length) {
    c.docker.healthUrls = profile.docker.healthUrls;
  }
  if (!profile.docker.enabled) {
    c.docker.enabled = false;
  }
  if (!profile.dast.enabled) {
    c.qualityGates.dast = { ...c.qualityGates.dast, enabled: false, mandatory: false };
  } else if (profile.dast.checks.length) {
    c.qualityGates.dast = { ...c.qualityGates.dast, enabled: true };
  }
  return c;
}

/** Heuristic profile for `npm run sdlc:init` when the file is missing. */
export function detectProjectProfile(repoRoot: string): SdlcProjectProfile {
  const p = { ...defaultProjectProfile };
  if (existsSync(path.join(repoRoot, 'apps/web')) && existsSync(path.join(repoRoot, 'apps/api'))) {
    p.name = 'monorepo-app';
    p.implementationPaths = [
      'apps/web/src/main.tsx',
      'apps/web/src/App.tsx',
      'apps/api/src/index.ts',
    ];
    p.reviewPaths = ['apps/web/src/main.tsx', 'apps/api/src/index.ts'];
    p.syncPathsFromMain = ['playwright.config.ts', 'tests'];
    p.commitMessageComponents = ['apps/web', 'apps/api', 'orchestrator'];
    p.commands.e2e = 'npx playwright test';
    p.dast = {
      enabled: true,
      checks: [{ url: 'http://127.0.0.1:4000/health' }, { url: 'http://127.0.0.1:4000/api/todos' }],
    };
    p.docker = {
      enabled: true,
      healthUrls: [
        { name: 'api', url: 'http://127.0.0.1:4000/health' },
        { name: 'web', url: 'http://127.0.0.1:5173' },
      ],
    };
    return p;
  }
  if (existsSync(path.join(repoRoot, 'package.json'))) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { name?: string };
      if (pkg.name) p.name = pkg.name;
    } catch {
      /* keep default */
    }
  }
  return p;
}
