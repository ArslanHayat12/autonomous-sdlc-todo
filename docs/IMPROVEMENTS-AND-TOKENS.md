# SDLC improvements & token usage

## Product features (what this repo does)

### Application

- React + Vite todo UI (`apps/web`)
- Express 5 REST API (`apps/api`)
- Playwright E2E (`tests/`)
- Optional Docker Compose for local API + web

### Automation pipeline (`npm run sdlc`)

| Phase | Feature |
|--------|---------|
| Git | Isolated **worktree**, semantic feature branches, sync uncommitted from main, optional prune/align/pull |
| AI plan | OpenAI markdown plan + `artifacts/plan.md` |
| AI implement | JSON full-file patches on paths from `sdlc.project.json` |
| Skills | Discover `skills/*/SKILL.md`, keyword routing, inject into plan/review/commit |
| Quality | Build, audit, Playwright E2E, optional Docker/SAST (config-driven) |
| Delivery | Commit, push, `gh pr create`, live PR body sync |
| Review | AI JSON findings + optional patch auto-fix loop |
| PR feedback | Severity-grouped comments + inline review threads |
| Merge | `gh pr merge` (+ `--auto` when enabled) |
| Ops | Reports in `artifacts/sdlc-reports/`, `.sdlc/workflow-state.json`, worker for issues/queue |
| Editor | Cursor MCP samples (GitHub, Playwright, Figma) — optional |

Toggles live in **`sdlc.features.json`**; policy (timeouts, gates) in **`orchestrator/sdlc.config.ts`**.

---

## Token consumption (where cost comes from)

Typical run = **plan + implement (+ retries) + review (+ fix iterations) + optional skill-aware commit message**.

| Hotspot | What gets sent |
|---------|----------------|
| Hero skills | Full `SKILL.md` bodies (now truncated) |
| Implement | Several full source files per attempt |
| Review | File contents or diffs per review path × iterations |
| Plan | Instruction + skill ids + `package.json` excerpt |
| Commit msg | Skill snippets + gate summary |

---

## Built-in savings (implemented)

1. **`ai.compactPrompts`: `true`** (default) — smaller per-file and per-skill caps; at most **2 skills** in prompts; shorter plan manifest excerpt.
2. **`prompt-budget.ts`** — central limits; override with env:
   - `SDLC_MAX_CHARS_PER_FILE`
   - `SDLC_MAX_CHARS_PER_SKILL`
   - `SDLC_MAX_SKILLS_IN_PROMPT`
   - `SDLC_MAX_BUILD_FEEDBACK_CHARS`
   - `SDLC_REVIEW_GIT_DIFF=0` — force full files in review (more tokens)
   - `SDLC_REVIEW_FULL_FILES=1` — same as disabling diff mode
3. **Review uses `git diff base...HEAD`** per file when possible (much smaller than whole files).
4. **`workflow.maxAiReviewIterations`** default **2** (was 3) in `sdlc.config.ts`.
5. **`SDLC_SKIP_PLAN=1`** — skip the OpenAI plan call (one fewer request).

### Cheaper models

Set in `.env`:

```bash
OPENAI_MODEL=gpt-4.1-mini   # or another small/cheap model your account supports
```

### Fewer AI steps

| Goal | Setting |
|------|---------|
| No code from AI | `ai.autoImplement: false` |
| No review loop | `ai.review: false` |
| Comments only, no fix commits | `ai.reviewAutoFix: false` |
| No skill injection | `ai.heroSkills: false` |
| Template commit message | `ai.commitMessageFromSkills: false` |

### Fewer files in prompts

Edit **`sdlc.project.json`** — shrink `implementationPaths` and `reviewPaths` to the minimal set that matters.

---

## Roadmap (not done yet — good next steps)

| Area | Idea |
|------|------|
| Resume | Finish `--resume` using `.sdlc/workflow-state.json` |
| Pipeline size | Split `pipeline.ts` into phase modules |
| Token telemetry | Log estimated prompt chars per step in reports |
| CI vs local | Skip Docker/SAST locally via feature flag |
| Review scope | Only changed files from `git diff --name-only` |
| Caching | Hash-based skip when instruction + tree unchanged |
| Security | Wire SAST gate outputs into review prompt |
| Human gate | Optional “approve plan before implement” |

---

## Config you changed in this pass

- **`sdlc.features.json`**: `ai.compactPrompts: true`, `quality.gatesInWorktree: true`
- **`orchestrator/sdlc.config.ts`**: `ai.promptBudget` defaults, `maxAiReviewIterations: 2`

See **README** for quick env tables and troubleshooting.
