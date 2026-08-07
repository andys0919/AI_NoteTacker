# Change: Run meeting summaries through a dedicated Codex PTY bot

## Why

AI_NoteTacker previously generated summaries with `codex exec` inside the
summary worker. The operator requires the existing shared
`claude-telegram-bot` Codex PTY architecture instead: one runtime per bot,
the same ChatGPT OAuth account, independent runtime state, and a fresh
conversation for every job.

## What Changes

- Add an AI_NoteTacker-owned HTTP-only instance of the existing shared runtime.
- Use the existing authenticated `POST /api/prompt` route; do not add a
  Report-specific task or usage API.
- Pin the runtime to `codex-pty`, `gpt-5.6-luna`, and effort `max`.
- Give the runtime its own `CODEX_HOME`, session directory, PTY namespace, and
  empty project-local working directory.
- Set `PTY_FRESH_SESSION_PER_TURN=true` and disable memory and profiling.
- Replace summary generation through `codex exec` with a small HTTP adapter
  while preserving prompt construction, schema validation, artifacts, audits,
  failure outcomes, and the existing non-generation weekly quota probe.
- Keep Azure summary fallback disabled in production.

## Impact

- Affected specs: `meeting-summary-generation`, `deployment-readiness`
- Affected code: summary transport/config/tests and production Compose
- External dependency: latest shared `claude-telegram-bot` source
- Data migration: none
