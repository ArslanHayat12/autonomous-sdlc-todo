# Autonomous SDLC Todo — autonomous pipeline starter

A React + TypeScript Todo app, Express API, Docker Compose, Playwright E2E, and a **config-driven** SDLC orchestrator under `orchestrator/`.

## Architecture (audit summary)

| Area | Role |
|------|------|
| `apps/web` | Vite + React UI |
| `apps/api` | Express JSON API |
| `orchestrator/` | Autonomous SDLC CLI — worktree isolation, OpenAI, `gh` PR/merge, optional Docker |
| `orchestrator/sdlc.config.ts` | **Single policy file** for AI, quality gates, Git, GitHub, Docker, workflow limits |
| `sdlc.features.json` | **Feature toggles** (optional JSON at repo root) — turn off worktrees, PR, merge, deploy, Hero skills, etc. without editing TypeScript |
| `skills/` | Local **AI Hero–style** `SKILL.md` files (install more via `SDLC_INSTALL_AIHERO_SKILLS=1` → `npx skills@latest add mattpocock/skills`) |
| `docker-compose.yml` | Local API + dev web for Docker workflow |

The orchestrator runs in **Node**, not inside Cursor: it **injects** `SKILL.md` content into OpenAI prompts. It does **not** invoke Cursor’s in-IDE skill runtime. Optional `npx skills@latest add` pulls the official catalog when you opt in.

## Requirements

- Node.js 22+, npm 10+, Git  
- `gh` + `gh auth login` for PR / merge automation  
- `OPENAI_API_KEY` for real AI implementation + review loops  
- Docker Desktop for compose build / local deploy steps  

## One-command SDLC

```bash
npm install
cp .env.example .env
# export OPENAI_API_KEY=...
npm run sdlc -- "Add authentication to Todo"
```

### CLI flags

| Flag | Behavior |
|------|----------|
| (default) | Full pipeline from `orchestrator/sdlc.config.ts` |
| `--dry-run` | Print merged config (policy + `sdlc.features.json`) to stdout |
| `--status` | Print `.sdlc/workflow-state.json` |
| `--resume` | Stub — shows state only (full resume not implemented) |
| `--deploy-only` | `docker compose` up + health curls |
| `--review-only` | Not implemented — use full run |

Environment overrides:

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` / `OPENAI_MODEL` | AI provider |
| `GITHUB_OWNER` / `GITHUB_REPO` | Override for `gh` when origin URL is unusual |
| `GITHUB_BASE_BRANCH` | PR base (else `gh repo view … defaultBranchRef`) |
| `SDLC_SKIP_PLAYWRIGHT` | `1` skips E2E (**mandatory e2e will fail merge** if enabled in config) |
| `SDLC_DEPLOY_LOCAL` | `1` runs `docker compose up -d --build` after **successful** `gh pr merge` (also set **`autoDeployLocal`** in `sdlc.features.json` to default-on without env) |
| `SDLC_INSTALL_AIHERO_SKILLS` | `1` runs `npx skills@latest add mattpocock/skills` when `skills/` is empty |
| `SDLC_KEEP_WORKTREE` | `1` keeps `.sdlc-worktrees/…` after run |

## What `npm run sdlc` does

1. Reads **`orchestrator/sdlc.config.ts`** (compiled to `dist/sdlc.config.js` at build time) and merges optional **`sdlc.features.json`** at the repo root.  
2. By default creates a **linked Git worktree** under `.sdlc-worktrees/` (**main checkout not modified**). Set `isolatedWorktree: false` in `sdlc.features.json` to use a new branch in the main clone instead (requires a **clean** working tree).  
3. Syncs paths from `syncPathsFromMain` (e.g. Playwright tests) into the worktree.  
4. **Plans** (OpenAI) using selected `skills/*/SKILL.md` content.  
5. **Implements** via OpenAI JSON patches (or a tiny fallback when no key).  
6. Runs **quality gates** from config (build, audit, e2e, optional DAST curl, optional `docker compose build`). **Skipped** gates are logged as **skipped**, not **passed**.  
7. **Commits** with a Conventional-Commit **title + body** describing why/what/tests/security.  
8. **Pushes** + **`gh pr create`** (labels from config).  
9. **AI review** loop (up to `maxAiReviewIterations`) with optional auto-fix commits + push.  
10. **`gh pr merge --squash`** when policies pass — **never** `--admin`; branch protection / required reviews still apply.  
11. Optional **local Docker deploy** if merge succeeded and **`autoDeployLocal`** is true in `sdlc.features.json` **or** `SDLC_DEPLOY_LOCAL=1`.  
12. Writes a Markdown report under `artifacts/sdlc-reports/` and `.sdlc/workflow-state.json`.

## Run the app locally

```bash
npm install
npm run dev
```

- UI: http://localhost:5173  
- API: http://localhost:4000/health  

## Tests

```bash
npm run test:orchestrator
npm run test:e2e
npm run security
npm run build
```

## Configuration

Edit **`orchestrator/sdlc.config.ts`** for AI limits, which gates are mandatory, PR labels, merge strategy, Docker health URLs, etc. **Do not put secrets in this file** — use `.env` / environment variables only.

### Feature toggles (`sdlc.features.json`)

Copy or edit **`sdlc.features.json`** at the **repository root** (next to the root `package.json`). Keys are optional; omitted keys use defaults (`npm run sdlc -- --dry-run` prints the merged result).

| Key | Default | Effect |
|-----|---------|--------|
| `isolatedWorktree` | `true` | `true`: linked worktree under `.sdlc-worktrees/`. `false`: new branch in the main clone (requires clean tree). |
| `pruneStaleWorktreesOnStart` | `true` | Remove old `sdlc__agent-*` worktrees before each run (when worktrees are enabled). |
| `autoImplement` | `true` | OpenAI (or fallback) code edits. `false`: plan + gates only, no patch application. |
| `aiHeroSkills` | `true` | Discover `skills/*/SKILL.md`, route into plan/review prompts. `false`: skip skill discovery. |
| `aiReview` | `true` | Post-PR AI review loop. `false`: skip review and auto-fix iterations. |
| `qualityGates` | `true` | Run gates from `sdlc.config.ts`. `false`: all gates disabled (merge policy reflects skipped/failed gates). |
| `autoCommit` | `true` | Commit changes in the session. |
| `autoPush` | `true` | Push the feature branch (`false` also disables PR creation; `gh pr create` needs a pushed branch). |
| `autoPr` | `true` | `gh pr create` when commit + push ran. |
| `autoMerge` | `true` | `gh pr merge` when policy allows (GitHub branch protection still applies). |
| `autoDeployLocal` | `false` | After successful merge: run local `docker compose` deploy (requires `docker.enabled` in `sdlc.config.ts`). Env `SDLC_DEPLOY_LOCAL=1` still works. |

## Honest limits

- **SAST / ESLint** gates are present in config but not wired to dedicated tools in this repo yet (disabled by default).  
- **Full resume** (`--resume`) and **`--review-only`** are placeholders.  
- **Merge** depends on GitHub: if checks or approvals are required, `gh pr merge` will fail with a clear message — this is intentional (no bypass).  
- **True AI Hero / Cursor skill execution** in-process is not available here; skills are **loaded from disk** and **verified** via `SKILL.md` presence, then used as **prompt context**.

## Security

- Keep `.env` out of Git.  
- Treat model output as untrusted; review PRs.  
- Use least-privilege `gh` and GitHub tokens.
