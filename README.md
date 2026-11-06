# Autonomous SDLC Todo — local-first starter

A small React + TypeScript Todo app with an Express API, Docker setup, Playwright E2E test, and a TypeScript SDLC runner. Designed to work locally with free/open-source tooling. OpenAI is optional for AI planning/review; GitHub and Figma MCP connections are optional Cursor integrations.

## Requirements
- Node.js 22+
- npm 10+
- Docker Desktop (optional, for containers)
- Git

## Run the Todo app

```bash
npm install
npm run dev
```

- UI: http://localhost:5173
- API health: http://localhost:4000/health

## Run in Docker

```bash
docker compose up --build
```

Open http://localhost:5173. Stop with `docker compose down`.

## Run tests and security checks

```bash
npx playwright install chromium
npm run test:e2e
npm run security
npm run build
```

`npm audit` needs internet access to query the npm advisory database. Playwright downloads Chromium once; this is free.

## Run the SDLC starter

```bash
cp .env.example .env
# Add OPENAI_API_KEY if you want AI planning and independent review
npm run sdlc -- "Add a priority field to Todo items with tests"
```

The runner checks that the working tree is clean, creates a local `agent/<timestamp>` branch, writes an AI plan/review when a key is present, runs build/audit/Playwright, and saves evidence under `artifacts/`. It does not silently edit arbitrary source files, push code, open a PR, or deploy. This is an intentionally safe scaffold: autonomous code-writing, iterative repair, PR creation, and deploy adapters are extension points, not falsely claimed as already implemented.

## Optional MCP integrations in Cursor

The `.cursor/mcp.json` file declares:
- GitHub MCP server via Docker (requires a GitHub token and Docker image pull).
- Figma hosted MCP server (authenticate through Cursor when prompted).
- Playwright MCP server for browser automation.

Set environment variables in your local shell before starting Cursor. Do not commit tokens or put them in source files. If your Cursor version expects a different MCP config location/schema, move/adapt `.cursor/mcp.json` using its MCP settings UI. These MCP servers are available to Cursor; the starter orchestrator does not yet invoke MCP tools itself.

GitHub publishing can later be enabled with `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, and `GITHUB_BASE_BRANCH`. Until a publishing adapter is implemented, the runner prepares local evidence only.

## Intended pipeline and current implementation status

| Stage | Starter status |
|---|---|
| Instruction intake | Implemented (CLI argument) |
| Repository analysis | Basic git + manifest inspection |
| Skill selection | AI planning prompt + skill catalog |
| Implementation | Human-applied; safe extension point |
| Independent AI review | Implemented for run evidence (not a code-diff review yet) |
| Build / dependency scan | Implemented |
| Playwright tests | Implemented |
| Automatic repair loop | Not implemented yet |
| Local branch / report commit | Implemented |
| GitHub PR | MCP config supplied; orchestrator PR adapter not implemented |
| Docker build | Docker Compose supplied; manual command |
| Human-approved deployment | Approval flag documented; no deploy adapter supplied |

## Security notes
- Keep `.env` out of Git.
- Use least-privilege GitHub tokens.
- Never let an AI agent run arbitrary shell commands without an allowlist and approval boundary.
- Treat Figma/GitHub MCP output as untrusted input.
- Do not deploy production workloads from this local demo.
