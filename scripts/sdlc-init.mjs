#!/usr/bin/env node
/**
 * One-time setup: `.env`, `sdlc.project.json`, `sdlc.features.json`.
 * Run from repository root: `npm run sdlc:init`
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function detectProfile() {
  const hasWeb = existsSync(path.join(root, 'apps/web'));
  const hasApi = existsSync(path.join(root, 'apps/api'));
  if (hasWeb && hasApi) {
    return {
      name: 'monorepo-app',
      implementationPaths: [
        'apps/web/src/main.tsx',
        'apps/web/src/App.tsx',
        'apps/api/src/index.ts',
      ],
      reviewPaths: ['apps/web/src/main.tsx', 'apps/api/src/index.ts'],
      syncPathsFromMain: ['playwright.config.ts', 'tests'],
      commitMessageComponents: ['apps/web', 'apps/api', 'orchestrator'],
      commands: {
        install: 'npm install',
        build: 'npm run build',
        security: 'npm run security',
        e2e: 'npx playwright test',
      },
      dast: {
        enabled: true,
        checks: [{ url: 'http://127.0.0.1:4000/health' }],
      },
      docker: { enabled: false, healthUrls: [] },
    };
  }
  let name = 'my-app';
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (pkg.name) name = pkg.name;
  } catch {
    /* ignore */
  }
  return {
    name,
    implementationPaths: [
      'src/index.ts',
      'src/main.tsx',
      'src/App.tsx',
      'app/page.tsx',
    ],
    reviewPaths: [],
    syncPathsFromMain: [],
    commitMessageComponents: ['src'],
    commands: {
      install: 'npm install',
      build: 'npm run build',
      security: 'npm audit --audit-level=high',
      e2e: '',
    },
    dast: { enabled: false, checks: [] },
    docker: { enabled: false, healthUrls: [] },
  };
}

const actions = [];

if (!existsSync(path.join(root, '.env'))) {
  copyFileSync(path.join(root, '.env.example'), path.join(root, '.env'));
  actions.push('Created .env from .env.example — add OPENAI_API_KEY');
} else {
  actions.push('.env already exists');
}

if (!existsSync(path.join(root, 'sdlc.project.json'))) {
  writeFileSync(path.join(root, 'sdlc.project.json'), JSON.stringify(detectProfile(), null, 2) + '\n');
  actions.push('Created sdlc.project.json (edit paths & commands for your app)');
} else {
  actions.push('sdlc.project.json already exists');
}

if (!existsSync(path.join(root, 'sdlc.features.json'))) {
  writeFileSync(
    path.join(root, 'sdlc.features.json'),
    JSON.stringify(
      {
        aiHeroSkills: true,
        autoImplement: true,
        autoCommit: true,
        autoPush: true,
        autoPr: true,
        autoMerge: true,
        qualityGates: true,
        isolatedWorktree: true,
      },
      null,
      2,
    ) + '\n',
  );
  actions.push('Created sdlc.features.json with sensible defaults');
}

console.log('\nSDLC init\n');
for (const a of actions) console.log(`  • ${a}`);
console.log(`
Next:
  1. Put OPENAI_API_KEY in .env
  2. gh auth login
  3. npm install
  4. npm run sdlc -- "Your task"

Adopting into another repo? See docs/ADOPT-IN-YOUR-REPO.md
`);
