# Hero skill catalog

Skills in this folder are **loaded at run time** by the SDLC orchestrator for planning and code review. Each skill is a directory with `SKILL.md`.

Installed skills:

| Directory | Role |
|-----------|------|
| `typescript-strict/SKILL.md` | TypeScript strictness and typing |
| `react-accessibility/SKILL.md` | React a11y patterns |
| `api-security/SKILL.md` | API security checks |

Add more directories following the same pattern. The orchestrator reads every `skills/<id>/SKILL.md` and passes the combined text into the Hero review step when `OPENAI_API_KEY` is set.
