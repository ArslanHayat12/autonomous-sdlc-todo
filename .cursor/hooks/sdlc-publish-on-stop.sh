#!/usr/bin/env bash
# Cursor hook: after agent turn, run `npm run sdlc:publish` when enabled.
# Enable with SDLC_CURSOR_PUBLISH_ON_STOP=1 in repo `.env` and/or environment.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${ROOT}" ]]; then
  exit 0
fi
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ "${SDLC_CURSOR_PUBLISH_ON_STOP:-}" != "1" ]]; then
  exit 0
fi

# Optional: require flag in sdlc.features.json (skip if jq missing)
if command -v jq >/dev/null 2>&1 && [[ -f sdlc.features.json ]]; then
  if [[ "$(jq -r '.agentEditAutoPublish // false' sdlc.features.json)" != "true" ]]; then
    exit 0
  fi
fi

# Consume stdin (hook protocol) so we do not block
cat >/dev/null 2>&1 || true

npm run sdlc:publish
exit 0
