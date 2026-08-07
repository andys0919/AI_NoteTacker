## Context

The host already runs the shared `claude-telegram-bot` runtime for QA, Mail,
FAE, and Report. AI_NoteTacker is different only at ingress: its summary worker
needs an HTTP response instead of a Telegram update. The shared runtime already
provides authenticated `/api/prompt` execution, so a second Codex process
implementation is unnecessary.

## Decision

Run one additional shared-runtime container in the AI_NoteTacker Compose
project. A tiny entrypoint starts only the existing Prompt API and supplies one
project definition:

- provider: `codex-pty`
- model/effort: `gpt-5.6-luna` / `max`
- cwd: `/workspace/codex-pty-workdir`, bind-mounted from the empty
  `.codex-pty-workdir` directory in the project
- fresh native session per accepted prompt
- memory and user profiling disabled
- wildcard filesystem policy required by the current unrestricted Codex PTY
  compatibility contract; the container remains the isolation boundary

The agent has a dedicated `CODEX_HOME`, PTY daemon namespace, and session
volume. Its `auth.json` is copied from the operator-selected shared OAuth
account; no writable runtime state is shared between bot processes.

The summary worker sends the existing meeting prompt to `/api/prompt` with a
dedicated bearer token and validates the returned `response` through the
existing summary schema. The 1 MiB request cap covers the measured transcript
range. The worker retains Codex CLI only for the existing
`account/rateLimits/read` probe; model execution no longer uses
`codex exec`.

Report remains a separate shared-runtime process and endpoint. AI_NoteTacker
does not call Report and no `/api/codex/tasks` or `/api/codex/usage` route is
introduced.

## Failure behavior

Prompt API authentication, transport, timeout, PTY, quota, and schema failures
remain explicit summary-stage failures. Production Azure summary credentials
stay empty, so failures do not silently switch providers.

## Rollout

1. Validate this OpenSpec change.
2. Build and test the HTTP adapter and runtime entrypoint.
3. Create the empty cwd and isolated Codex/state volumes, then seed OAuth.
4. Deploy the AI_NoteTacker agent and summary worker.
5. Run an authenticated live summary and concurrent Report/AI PTY smoke.
