# Use this SDLC platform in any repository

Copy the **orchestrator + config** into your project, set `OPENAI_API_KEY`, tune **`sdlc.project.json`**, run `npm run sdlc`.

## Quick start (this template repo)

```bash
git clone <this-repo> my-product
cd my-product
npm run sdlc:init    # creates .env + sdlc.project.json if missing
# edit .env → OPENAI_API_KEY=sk-...
npm install
gh auth login
npm run sdlc -- "Add user settings page"
```

The CLI loads **`.env` automatically** (repo root). No need to `export` unless you prefer it.

## Drop into an existing project

Copy these paths from this repo into **your** repo root:

| Path | Purpose |
|------|---------|
| `orchestrator/` | SDLC CLI (Node + TypeScript) |
| `skills/` | Local AI Hero `SKILL.md` files (optional) |
| `scripts/sdlc-auto.mjs`, `scripts/sdlc-publish-auto.mjs`, `scripts/sdlc-init.mjs` | npm script wrappers |
| `.github/workflows/sdlc.yml` | Optional CI runner |
| `tasks/queue.json` | Optional local worker queue |
| `.env.example` | Env template |
| `sdlc.project.example.json` | Profile template |

Add to **your** root `package.json`:

```json
{
  "workspaces": ["orchestrator"],
  "scripts": {
    "sdlc": "npm --workspace orchestrator run sdlc",
    "sdlc:init": "node scripts/sdlc-init.mjs",
    "sdlc:auto": "node scripts/sdlc-auto.mjs",
    "sdlc:publish": "node scripts/sdlc-publish-auto.mjs",
    "build": "npm run build --workspaces --if-present"
  }
}
```

Then:

```bash
cp sdlc.project.example.json sdlc.project.json
npm run sdlc:init
```

Edit **`sdlc.project.json`** — this is the only project-specific file you must maintain:

- **`implementationPaths`** — files the AI may read/patch
- **`commands.build` / `install` / `security` / `e2e`** — what the pipeline runs
- **`syncPathsFromMain`** — tests/config copied into the worktree
- **`dast.checks`** — optional `curl` smoke URLs (disable with `"enabled": false`)

Edit **`sdlc.features.json`** (nested groups: `automation`, `ai`, `git`, `delivery`, `quality`, `deploy`, `integrations`) for toggles. Flat legacy keys still work.

Policy defaults stay in **`orchestrator/sdlc.config.ts`** (shared across projects).

## Per-project vs shared config

| File | Scope |
|------|--------|
| `.env` | Secrets + `SDLC_INSTRUCTION` (never commit) |
| `sdlc.project.json` | **Your app** — paths & commands |
| `sdlc.features.json` | Automation on/off per repo |
| `orchestrator/sdlc.config.ts` | Platform defaults (merge strategy, models, gate timeouts) |

## Requirements

- Node 22+, Git, `gh` (for PR/merge)
- `OPENAI_API_KEY` in `.env` for AI implement + Hero skills in prompts
