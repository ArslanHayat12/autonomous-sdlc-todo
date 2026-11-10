# Autonomous SDLC Todo

A small **Todo app** plus an **automation pipeline** that can plan changes, edit code, test, open a GitHub PR, review, comment, fix, and merge — mostly without hand-holding.

Good for learning how “agent + git + CI-style gates” fit together, or as a starter you copy into your own repo.

---

## What you get

| Piece | Folder | Purpose |
|--------|--------|---------|
| Web UI | `apps/web` | React + Vite todo list |
| API | `apps/api` | Express REST API |
| SDLC bot | `orchestrator/` | CLI that runs the full pipeline |
| Skills | `skills/` | Extra instructions for AI plan/review (`SKILL.md` per topic) |
| E2E tests | `tests/` | Playwright happy-path test |
| Docker | `docker-compose.yml` | Optional local API + web in containers |

---

## Pros and cons

### Pros

- **Safe git model** — By default work happens in a **linked worktree** (`.sdlc-worktrees/`), so your dirty `main` checkout is not touched.
- **One command** — `npm run sdlc -- "your task"` → plan, implement, test, commit, PR, AI review, optional merge.
- **Feature toggles** — Turn steps on/off in **`sdlc.features.json`** without editing TypeScript.
- **Skills** — Drop `skills/<name>/SKILL.md` files; the orchestrator injects them into OpenAI plan/review prompts.
- **Tests before commit** — Build + Playwright E2E when `quality.gatesInWorktree` is `true`; optional Husky pre-commit hook.
- **PR transparency** — Live PR checklist, AI review comments (critical/high/medium/low), optional auto-fix commits.
- **Worker mode** — `npm run sdlc:worker` can drain GitHub issues or `tasks/queue.json`.

### Cons

- **Needs OpenAI + GitHub** — Real automation expects `OPENAI_API_KEY` in `.env` and `gh auth login` (or `GITHUB_TOKEN`).
- **Merge is not magic** — Branch protection, required reviews, and failing CI on GitHub can still block `gh pr merge` (by design; no `--admin` bypass).
- **Skills ≠ Cursor runtime** — Skills are **text files on disk**, not Cursor’s in-IDE skill execution.
- **Resume is limited** — `--resume` is mostly a stub; interrupted runs are not fully continued yet.
- **Can be slow** — Playwright + Docker gates + multiple OpenAI calls = several minutes per run.
- **`alignMainWithRemoteAfterRun`** — If enabled, a hard reset to `origin/main` after each run **wipes uncommitted local changes** on `main` (turn off while iterating).

---

## Tech stack

| Layer | Libraries / tools |
|--------|-------------------|
| Frontend | React, Vite, TypeScript |
| API | Express 5, TypeScript, CORS |
| Orchestrator | Node 22+, TypeScript, OpenAI SDK |
| Tests | Playwright (`@playwright/test`) |
| Monorepo | npm workspaces |
| Git / GitHub | `git`, `gh` CLI |
| Optional | Docker Compose, Husky (pre-commit) |
| Editor integration | Cursor MCP (`.cursor/mcp.json` — GitHub, Figma, Playwright MCP) |

---

## Quick start (new teammate)

### 1. Install

```bash
git clone <your-repo-url>
cd autonomous-sdlc-todo
npm install
cp .env.example .env
```

### 2. Configure `.env`

| Variable | Required? | Notes |
|----------|-----------|--------|
| `OPENAI_API_KEY` | Yes for AI | Put key in `.env`; blank shell is OK — verify with `npm run sdlc:check-env` |
| `OPENAI_MODEL` | No | Default `gpt-4.1-mini` in example |
| `GITHUB_TOKEN` | For `gh` | Classic PAT with `repo` scope; or run `gh auth login` |
| `GITHUB_OWNER` / `GITHUB_REPO` | No | **Leave blank** to use `git remote`; empty lines break PR create |
| `SDLC_INSTRUCTION` | No | Default task for `npm run sdlc:auto` |

Do **not** commit `.env`.

### 3. GitHub CLI

```bash
gh auth login
# or refresh if token expired:
gh auth refresh -h github.com
```

### 4. Run the app (manual)

```bash
npm run dev
```

- Web: http://localhost:5173  
- API health: http://localhost:4000/health  

### 5. Run one automated SDLC task

```bash
npm run sdlc -- "Analyze the Todo app and propose one small, safe improvement."
```

Watch for:

- `openai — API key loaded`  
- `github — https://github.com/.../pull/N`  
- Report under `artifacts/sdlc-reports/`

### 6. Verify env (optional)

```bash
npm run sdlc:check-env
```

---

## Main commands

| Command | What it does |
|---------|----------------|
| `npm run sdlc -- "task"` | Full pipeline (worktree, AI, gates, PR, review, merge if allowed) |
| `npm run sdlc:auto` | Same, instruction from `SDLC_INSTRUCTION` in `.env` |
| `npm run sdlc -- --dry-run` | Print merged config (policy + features) |
| `npm run sdlc -- --publish` | Commit **your current edits**, PR, merge (no AI implement; needs `isolatedWorktree: false`) |
| `npm run sdlc:worker` | Loop: GitHub issues + `tasks/queue.json` |
| `npm run build` | Typecheck/build all workspaces |
| `npm run test:e2e` | Playwright (starts API + web) |
| `npm run precommit:check` | Build + E2E (what Husky runs) |
| `npm run sdlc:check-env` | Confirm `.env` loads OpenAI key (no secret printed) |

---

## Enable / disable features

Edit **`sdlc.features.json`** at the repo root. Defaults are merged with `orchestrator/sdlc.config.ts`.

Use nested groups (recommended):

```json
{
  "automation": { "fullAgentAutomation": true },
  "ai": {
    "autoImplement": true,
    "heroSkills": true,
    "review": true,
    "reviewAutoFix": true,
    "reviewPrComments": true,
    "compactPrompts": true
  },
  "delivery": {
    "autoCommit": true,
    "autoPush": true,
    "autoPr": true,
    "autoMerge": true
  },
  "quality": { "gatesInWorktree": true },
  "git": { "isolatedWorktree": true }
}
```

### Cheat sheet (plain English)

| You want… | Set in `sdlc.features.json` |
|-----------|-------------------------------|
| Hands-off commit → PR → merge | `"fullAgentAutomation": true` + working `gh` auth |
| AI writes code | `ai.autoImplement`: `true` |
| AI review on PR | `ai.review`: `true` |
| AI fixes review findings + pushes | `ai.reviewAutoFix`: `true` (needs `delivery.autoCommit`) |
| GitHub review comments | `ai.reviewPrComments`: `true` |
| Build + audit + Playwright before commit | `quality.gatesInWorktree`: `true` |
| No worktree (publish from main clone) | `git.isolatedWorktree`: `false` |
| Human merges on GitHub | `automation.requireHumanApprovalBeforeMerge`: `true` |
| Stop hard-resetting `main` after every run | `git.alignMainWithRemoteAfterRun`: `false` or `SDLC_SKIP_ALIGN_MAIN_AFTER_RUN=1` in `.env` |
| Smaller OpenAI prompts (fewer tokens) | `ai.compactPrompts`: `true` (default) — see [docs/IMPROVEMENTS-AND-TOKENS.md](docs/IMPROVEMENTS-AND-TOKENS.md) |

**Policy details** (timeouts, mandatory gates, PR labels): edit `orchestrator/sdlc.config.ts`.  
**Per-project paths** (which files AI sees): `sdlc.project.json`.

### Environment overrides (one-off)

| Variable | Effect |
|----------|--------|
| `SDLC_SKIP_PLAYWRIGHT=1` | Skip E2E in SDLC (mandatory e2e may block merge) |
| `SDLC_SKIP_REVIEW_AUTO_FIX=1` | Review runs; no auto-fix commits |
| `SDLC_SKIP_PR_REVIEW_COMMENTS=1` | No PR review comments |
| `SDLC_SKIP_ALIGN_MAIN_AFTER_RUN=1` | Do not hard-reset local `main` after run |
| `SKIP_PRE_COMMIT_CHECKS=1` | Skip Husky build/e2e once |
| `SDLC_SKIP_PLAN=1` | Skip OpenAI plan step (saves one API call) |
| `SDLC_MAX_CHARS_PER_FILE` / `_PER_SKILL` | Override prompt size caps |

Full list: **`.env.example`**. Deeper guide: **[docs/IMPROVEMENTS-AND-TOKENS.md](docs/IMPROVEMENTS-AND-TOKENS.md)** (feature list, token tips, roadmap).

---

## Feature list (pipeline)

| Category | Capabilities |
|----------|----------------|
| **Git** | Worktree isolation, feature branches, sync uncommitted, pull/ff main, optional align/reset after run |
| **AI** | Plan, implement patches, Hero skills, review + auto-fix, PR review comments, skill-aware commit messages |
| **Quality** | Build, npm audit, Playwright E2E, optional Docker/SAST gates |
| **Delivery** | Auto commit/push/PR/merge (`fullAgentAutomation`) |
| **Observability** | Step logs, `artifacts/sdlc-reports/`, `.sdlc/last-error.json` |
| **Worker** | `sdlc:worker` — issues + `tasks/queue.json` |

---

## AI Hero skills

Skills live under **`skills/<id>/SKILL.md`**. The orchestrator **reads** them and adds the text to OpenAI prompts (plan + review). It does **not** run Cursor’s skill tools.

**Shipped examples** (repo root `skills/`):

- `typescript-strict` — strict TypeScript habits  
- `react-accessibility` — a11y for React  
- `api-security` — API security checks  

**Enable / disable skills for a run:**

- `ai.heroSkills`: `true` in `sdlc.features.json` (discovery + routing)  
- Add folders under `skills/` with a `SKILL.md`  
- Optional catalog install: `SDLC_INSTALL_AIHERO_SKILLS=1` (see `skills/README.md`)

There is also a large **`.agents/skills/`** tree (Cursor/agent docs); SDLC’s default catalog for this app is **`skills/`** at the repo root.

---

## What `npm run sdlc` does (short)

1. Load `.env` (OpenAI + GitHub).  
2. Create a **feature branch** in a worktree (unless in-place mode).  
3. Copy uncommitted files from your main checkout if enabled.  
4. **Plan** + **implement** with OpenAI (and skills).  
5. **Build** + **Playwright** (+ other gates if enabled).  
6. **Commit** → **push** → **`gh pr create`**.  
7. **AI review** → optional **auto-fix** → **PR comments** (severity).  
8. **Merge** via `gh` if policy + GitHub allow.  
9. Write report to `artifacts/sdlc-reports/` and `.sdlc/workflow-state.json`.

Longer step-by-step and env tables lived in earlier README revisions; see also **`docs/ADOPT-IN-YOUR-REPO.md`**, **`docs/PLAYWRIGHT-MCP.md`**.

---

## Playwright + pre-commit

- **SDLC:** `quality.gatesInWorktree: true` runs E2E before commit.  
- **Local git:** Husky runs `scripts/pre-commit-check.mjs` (`npm run build` + `test:e2e`) after `npm install`.  
- **Cursor:** Playwright MCP in [`.cursor/mcp.json`](.cursor/mcp.json) — see [docs/PLAYWRIGHT-MCP.md](docs/PLAYWRIGHT-MCP.md).

---

## Troubleshooting

| Symptom | Likely fix |
|---------|------------|
| `No OPENAI_API_KEY: skipped…` | Key in repo root `.env`; re-run; look for `openai — API key loaded` |
| PR not created | `gh auth login` or `GITHUB_TOKEN` in `.env`; remove blank `GITHUB_OWNER=` lines |
| Merge skipped | No PR number, failing mandatory gates, or GitHub branch protection |
| Pipeline “stuck” after sync | Next step is **silent `npm install` in the worktree** (1–3 min), then OpenAI plan/implement — you should see `npm install (worktree)`, `plan`, `implement` lines after updating orchestrator |
| Local changes gone after SDLC | `alignMainWithRemoteAfterRun: true` hard-resets `main` — commit orchestrator changes or disable align |
| `gatesInWorktree: false` | All worktree gates off — turn **`quality.gatesInWorktree`** to **`true`** for build/e2e before commit |

Errors: **`.sdlc/last-error.json`**.

---

## Project layout

```
apps/web/          → React UI
apps/api/          → Express API
orchestrator/      → SDLC CLI + worker
skills/            → AI Hero SKILL.md files (SDLC uses these)
sdlc.features.json → On/off switches (start here)
sdlc.project.json  → Which files/commands for this repo
orchestrator/sdlc.config.ts → Timeouts, gate policy, PR templates
.env               → Secrets (not in git)
.cursor/mcp.json   → Optional Cursor MCP servers
```

---

## Security

- Never commit `.env` or API keys.  
- Treat AI-generated patches as untrusted until reviewed.  
- Use least-privilege GitHub tokens.  
- The orchestrator never uses `gh pr merge --admin`.

---

## License / adoption

Use **`docs/ADOPT-IN-YOUR-REPO.md`** to copy the orchestrator into another project and tune `sdlc.project.json`.
