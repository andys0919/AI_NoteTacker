## 1. Contract

- [x] 1.1 Confirm one Codex PTY runtime and working directory per bot.
- [x] 1.2 Confirm shared OAuth with isolated `CODEX_HOME`, PTY, and session state.
- [x] 1.3 Reject the Report-owned special task/usage endpoint design.

## 2. Implementation

- [x] 2.1 Add the HTTP-only shared-runtime service with the existing
  authenticated `/api/prompt` route and 1 MiB body cap.
- [x] 2.2 Pin Codex PTY to Luna/max, an empty cwd, fresh sessions, and no memory.
- [x] 2.3 Replace summary `codex exec` generation with the Prompt API adapter.
- [x] 2.4 Keep the existing weekly quota probe and explicit no-Azure failure path.

## 3. Verification and deployment

- [x] 3.1 Run focused Python tests, TypeScript check, strict OpenSpec validation,
  and resolved Compose validation.
- [x] 3.2 Deploy the isolated runtime and summary worker.
- [x] 3.3 Verify auth rejection, live structured summary generation, fresh
  sessions, and concurrent Report/AI Codex PTY use.
