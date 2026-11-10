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
  const p = detectProfile();
  const project = {
    meta: { version: 1, name: p.name, description: 'SDLC paths and commands for this repo.' },
    paths: {
      implementation: p.implementationPaths,
      review: p.reviewPaths,
      syncFromMainCheckout: p.syncPathsFromMain,
      commitMessageComponents: p.commitMessageComponents,
    },
    commands: p.commands,
    dast: p.dast,
    docker: p.docker,
  };
  writeFileSync(path.join(root, 'sdlc.project.json'), JSON.stringify(project, null, 2) + '\n');
  actions.push('Created sdlc.project.json (edit paths & commands for your app)');
} else {
  actions.push('sdlc.project.json already exists');
}

if (!existsSync(path.join(root, 'sdlc.features.json'))) {
  const featuresExample = path.join(root, 'sdlc.features.example.json');
  if (existsSync(featuresExample)) {
    copyFileSync(featuresExample, path.join(root, 'sdlc.features.json'));
  } else {
    writeFileSync(
      path.join(root, 'sdlc.features.json'),
      JSON.stringify({ ai: { heroSkills: true, autoImplement: true }, delivery: { autoPr: true } }, null, 2) + '\n',
    );
  }
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
