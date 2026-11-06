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

### Hands-off run (no instruction on the command line)

For **automation** (cron, CI, desktop shortcut), put the task in **`SDLC_INSTRUCTION`** in `.env` and run:

```bash
npm run sdlc:auto
```

That runs `npm run sdlc` with **no argv**; the orchestrator uses **`process.env.SDLC_INSTRUCTION`** as the default instruction (CLI args still win if you pass them).

Similarly, **`npm run sdlc:publish`** runs **`npm run sdlc -- --publish`** with no argv (instruction still from **`SDLC_INSTRUCTION`**).

On **GitHub Actions**, use workflow [`.github/workflows/sdlc.yml`](.github/workflows/sdlc.yml): set repo secrets **`OPENAI_API_KEY`**, optionally **`SDLC_INSTRUCTION`**, and **`GH_TOKEN`** (or rely on the default `GITHUB_TOKEN`). Trigger **workflow_dispatch** or edit the `schedule` cron — no one types `npm run sdlc` on their laptop.

### Cursor agent: edit in the editor, then PR + merge (no full SDLC)

The orchestrator cannot see Cursor’s chat or tool edits until they are **saved as files in the repo**. For **PR + auto-merge from those files** (no OpenAI plan/implementation pass):

1. Set **`"isolatedWorktree": false`** in **`sdlc.features.json`** (publish uses your **main checkout**; `true` is for isolated SDLC worktrees).
2. Put the short description in **`SDLC_INSTRUCTION`** (`.env` or export).
3. Let the agent change files, then run:

   ```bash
   npm run sdlc -- --publish
   ```

   Or hands-off: **`npm run sdlc:publish`**.

Optional: **`.cursor/hooks.json`** runs **`.cursor/hooks/sdlc-publish-on-stop.sh`** on **`stop`**. Enable with **`SDLC_CURSOR_PUBLISH_ON_STOP=1`** in `.env` and **`"agentEditAutoPublish": true`** in **`sdlc.features.json`** — after each agent completion it runs **`npm run sdlc:publish`** (can be slow; requires `gh` auth).

### CLI flags

| Flag | Behavior |
|------|----------|
| (default) | Full pipeline from `orchestrator/sdlc.config.ts` |
| `--dry-run` | Print merged config (policy + `sdlc.features.json`) to stdout |
| `--status` | Print `.sdlc/workflow-state.json` |
| `--resume` | Stub — shows state only (full resume not implemented) |
| `--deploy-only` | `docker compose` up + health curls |
| `--review-only` | Not implemented — use full run |
| `--publish` | Commit **existing** working-tree changes, push, open PR, merge (no SDLC AI); requires **`isolatedWorktree: false`** |

Environment overrides:

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` / `OPENAI_MODEL` | AI provider |
| `SDLC_INSTRUCTION` | Default task when `npm run sdlc` / `sdlc:auto` have **no** quoted instruction (CLI args override) |
| `SDLC_VERIFY_COMMAND` | Override pre-SDLC verification command on `main` (default from `mainRepoVerificationCommand` in `sdlc.features.json`) |
| `SDLC_SKIP_MAIN_VERIFY` | `1` skips `runMainRepoVerificationBeforeSdlc` even when enabled in JSON |
| `GITHUB_OWNER` / `GITHUB_REPO` | Override for `gh` when origin URL is unusual |
| `GITHUB_BASE_BRANCH` | PR base (else `gh repo view … defaultBranchRef`) |
| `SDLC_SKIP_LABEL_ENSURE` | `1` skips `gh label create` before PR (default: create missing labels from `sdlc.config.ts` so `gh pr create --label` succeeds) |
| `SDLC_SKIP_PLAYWRIGHT` | `1` skips E2E (**mandatory e2e will fail merge** if enabled in config) |
| `SDLC_DEPLOY_LOCAL` | `1` runs `docker compose up -d --build` after **successful** `gh pr merge` (also set **`autoDeployLocal`** in `sdlc.features.json` to default-on without env) |
| `SDLC_INSTALL_AIHERO_SKILLS` | `1` runs `npx skills@latest add mattpocock/skills` when `skills/` is empty |
| `SDLC_KEEP_WORKTREE` | `1` keeps `.sdlc-worktrees/…` after run |
| `SDLC_SKIP_AUTO_PULL` | `1` skips all automatic `git fetch` + fast-forward merges on your base-branch checkout (see `autoPullMain*` in `sdlc.features.json`) |
| `SDLC_SKIP_SYNC_BEFORE_MERGE` | `1` skips **rebase onto `origin/<base>`** + **`git push --force-with-lease`** before `gh pr merge` (default: sync so GitHub can merge when `main` moved during the run) |
| `SDLC_SKIP_RESET_MAIN_AFTER_MERGE` | `1` skips **`git reset --hard origin/<base>`** after a successful merge when **`resetMainCheckoutAfterMerge`** is true |
| `SDLC_CURSOR_PUBLISH_ON_STOP` | `1` allows the Cursor **`stop`** hook to run **`npm run sdlc:publish`** (also set **`agentEditAutoPublish`** in `sdlc.features.json`) |

## What `npm run sdlc` does

1. Reads **`orchestrator/sdlc.config.ts`** (compiled to `dist/sdlc.config.js` at build time) and merges optional **`sdlc.features.json`** at the repo root.  
2. Optionally **fast-forwards** a **clean** base-branch checkout (`autoPullMainBeforeRun`).  
3. Optionally **verifies** the **main** checkout before the worktree (`runMainRepoVerificationBeforeSdlc`, default command `npm run build`) — fails fast if your last local/test state is broken.  
4. By default creates a **linked Git worktree** under `.sdlc-worktrees/` (**main checkout not modified**). Set `isolatedWorktree: false` in `sdlc.features.json` to use a new branch in the main clone instead (requires a **clean** working tree).  
5. Syncs paths from `syncPathsFromMain`, then (by default) **uncommitted files from your main checkout** into the worktree — isolated runs no longer ignore files you have not committed on `main`.  
6. **Plans** (OpenAI) using selected `skills/*/SKILL.md` content.  
7. **Implements** via OpenAI JSON patches (or a tiny fallback when no key).  
8. Runs **quality gates** from config (build, audit, e2e, optional DAST curl, optional `docker compose build`). **Skipped** gates are logged as **skipped**, not **passed**.  
9. **Commits** with a Conventional-Commit **title + body** (OpenAI + selected skills when **`autoCommitMessageFromSkills`** and `OPENAI_API_KEY` are set; else template).  
10. **Pushes** + **ensures PR labels exist** (`gh label create … --force` for each configured label, unless `SDLC_SKIP_LABEL_ENSURE=1`) + **`gh pr create`** + optional **pull on base branch** (`autoPullMainAfterPr`).  
11. **AI review** loop (up to `maxAiReviewIterations`) with optional auto-fix commits + push.  
12. **Sync branch for merge**: **`git fetch`**, **`git rebase origin/<baseBranch>`** on the feature branch, **`git push --force-with-lease`** (unless **`SDLC_SKIP_SYNC_BEFORE_MERGE=1`**) so GitHub does not report “not mergeable” when the default branch advanced mid-run.  
13. **`gh pr merge --squash`** when policies pass — **never** `--admin`; branch protection / required reviews still apply; then optional **pull** so local `main` matches remote (`autoPullMainAfterMerge`).  
14. Optional **hard reset** of local **`main`** to **`origin/main`** when **`resetMainCheckoutAfterMerge`** is true (clears leftover uncommitted noise — skipped if the tree is dirty or **`SDLC_SKIP_RESET_MAIN_AFTER_MERGE=1`**).  
15. Optional **local Docker deploy** if merge succeeded and **`autoDeployLocal`** is true in `sdlc.features.json` **or** `SDLC_DEPLOY_LOCAL=1`.  
16. Writes a Markdown report under `artifacts/sdlc-reports/` and `.sdlc/workflow-state.json`.

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
| `fullAgentAutomation` | `false` | **`true`**: sets `autoCommit`, `autoPush`, `autoPr`, `autoMerge` and **`requireHumanApprovalBeforeMerge: false`** so the CLI keeps trying through merge without a separate “human merge only” toggle. |
| `requireHumanApprovalBeforeMerge` | `false` | `true`: **skip** `gh pr merge` (human merges on GitHub). `false`: run merge when `autoMerge` and policy allow. |
| `runMainRepoVerificationBeforeSdlc` | `false` | `true`: run **`mainRepoVerificationCommand`** on the **main checkout** after pull, **before** the worktree (built-in “tested baseline” gate). |
| `mainRepoVerificationCommand` | `npm run build` | Shell command for that verification; override with env **`SDLC_VERIFY_COMMAND`**. |
| `resetMainCheckoutAfterMerge` | `false` | `true`: after a successful merge (full SDLC or `--publish`), **`git reset --hard origin/<baseBranch>`** on a **clean** checkout of `baseBranch` (clears stray uncommitted files). |
| `agentEditAutoPublish` | `false` | `true`: Cursor **`stop`** hook may run **`npm run sdlc:publish`** when **`SDLC_CURSOR_PUBLISH_ON_STOP=1`** (see README “Cursor agent”). |
| `isolatedWorktree` | `true` | `true`: linked worktree under `.sdlc-worktrees/`. `false`: new branch in the main clone (requires clean tree). |
| `pruneStaleWorktreesOnStart` | `true` | Remove old `sdlc__agent-*` worktrees before each run (when worktrees are enabled). |
| `autoImplement` | `true` | OpenAI (or fallback) code edits. `false`: plan + gates only, no patch application. |
| `aiHeroSkills` | `true` | Discover `skills/*/SKILL.md`, route into plan/review prompts. `false`: skip skill discovery. |
| `aiReview` | `true` | Post-PR AI review loop. `false`: skip review and auto-fix iterations. |
| `qualityGates` | `true` | Run gates from `sdlc.config.ts`. `false`: gates skipped (**`--publish`** uses this too; mandatory **skipped** does not block auto-merge). |
| `autoCommit` | `true` | Commit changes in the session. |
| `autoPush` | `true` | Push the feature branch (`false` also disables PR creation; `gh pr create` needs a pushed branch). |
| `autoPr` | `true` | `gh pr create` when commit + push ran. |
| `autoMerge` | `true` | `gh pr merge` when policy allows (GitHub branch protection still applies). |
| `autoDeployLocal` | `false` | After successful merge: run local `docker compose` deploy (requires `docker.enabled` in `sdlc.config.ts`). Env `SDLC_DEPLOY_LOCAL=1` still works. |
| `syncUncommittedFromMain` | `true` | After `syncPathsFromMain`, copy **uncommitted** files from your main checkout into the worktree so `autoCommit` can include local edits (without committing on `main` first). Set `false` to only use committed state + listed sync paths + AI. |
| `autoPullMainBeforeRun` | `true` | Before the worktree: if you're on a **clean** `git.baseBranch`, `git fetch` + `merge --ff-only origin/<branch>`. |
| `autoPullMainAfterPr` | `true` | After a PR is created: same **fast-forward pull** on your `main` checkout (if clean and on base branch). |
| `autoPullMainAfterMerge` | `true` | After **`gh pr merge` succeeds**: fast-forward **local** `main` so it includes the merge. |
| `autoCommitMessageFromSkills` | `true` | If `OPENAI_API_KEY` is set and **Hero skills** were selected, use the model to draft the conventional commit (aligned with `SKILL.md` context); otherwise use the template. |

## Honest limits

- **SAST / ESLint** gates are present in config but not wired to dedicated tools in this repo yet (disabled by default).  
- **Full resume** (`--resume`) and **`--review-only`** are placeholders.  
- **Merge** depends on GitHub: if checks or approvals are required, `gh pr merge` will fail with a clear message — this is intentional (no bypass).  
- **True AI Hero / Cursor skill execution** in-process is not available here; skills are **loaded from disk** and **verified** via `SKILL.md` presence, then used as **prompt context**.

## Security

- Keep `.env` out of Git.  
- Treat model output as untrusted; review PRs.  
- Use least-privilege `gh` and GitHub tokens.
