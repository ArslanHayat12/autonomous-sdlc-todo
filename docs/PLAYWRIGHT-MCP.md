# Playwright MCP + E2E before commit

## Cursor MCP (agents)

The repo ships [`.cursor/mcp.json`](../.cursor/mcp.json) with a **playwright** server:

```json
"playwright": {
  "command": "npx",
  "args": ["-y", "@playwright/mcp@latest"]
}
```

Enable it in **Cursor Settings → MCP**, then agents can drive the browser to verify UI flows while editing. After code changes, run the same checks locally:

```bash
npm run test:e2e
```

## SDLC pipeline (automation)

In **`sdlc.features.json`**, set **`quality.gatesInWorktree`** to **`true`** so build, audit, and **Playwright E2E** run in the worktree **before** `git commit`.

- E2E uses [`playwright.config.ts`](../playwright.config.ts) (starts API + web dev servers).
- Mandatory gate failure **blocks commit and merge** (see `mandatory-gates.ts`).
- During AI implement retries, **build + E2E** must pass before the loop finishes.
- Opt out temporarily: `SDLC_SKIP_PLAYWRIGHT=1` (merge will fail if e2e is mandatory).

## Local git pre-commit

With **Husky** (`npm install` runs `prepare`):

1. `npm run build`
2. `npx playwright install chromium`
3. `npm run test:e2e`

Skip once: `SKIP_PRE_COMMIT_CHECKS=1 git commit …`  
Skip only Playwright: `SKIP_PLAYWRIGHT_PRE_COMMIT=1`

## Regression coverage

[`tests/todo.spec.ts`](../tests/todo.spec.ts) covers add → complete → filter (Done) → delete. Any change to todo UI or API should keep this spec green.

## SDLC looks “stuck” after sync

After **sync uncommitted from main**, the orchestrator runs **`npm install`** in the worktree (now logged), then OpenAI **plan/implement**, then **Playwright** (1–3 minutes with little console output while dev servers start). Watch for lines like `npm install`, `plan`, `e2e — Running Playwright…`.
