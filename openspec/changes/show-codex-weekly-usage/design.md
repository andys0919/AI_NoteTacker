## Context

The Codex app server officially exposes `account/rateLimits/read`. Its quota
window fields are `usedPercent`, `windowDurationMins`, and `resetsAt`. The live
Business account currently returns a `codex` window of 10,080 minutes (seven
days).

Only the summary worker can access the dedicated Codex credential volume. The
control plane and browser must not gain access to that volume or its auth file.

## Goals / Non-Goals

- Goals: truthful weekly remaining percentage, reset time, observation time,
  authenticated admin visibility, and explicit unavailable behavior.
- Non-goals: purchasing or consuming reset credits, predicting message/token
  counts, exposing OAuth/account identity, or persisting historical allowance
  snapshots.

## Decisions

- Refactor the existing quota probe so one reader returns the official rate-limit
  result; keep the existing exhaustion classifier on top of that reader.
- Select only the `codex` bucket whose window is exactly 10,080 minutes. Compute
  remaining percentage as `100 - usedPercent`, clamped to 0–100. Do not label a
  shorter or longer window as weekly.
- Piggyback the sanitized snapshot on the existing summary-worker claim request.
  Cache the probe for 60 seconds so the worker does not start Codex app-server on
  every one-second poll.
- Keep only the latest snapshot in the control-plane process. The worker repeats
  it on each claim poll, so a control-plane restart is repopulated without a new
  table or migration.
- Render a native `<progress>` element with textual used/remaining values,
  reset time, and last-observed time. Color is supplemental, not the only state
  signal.

## Risks / Trade-offs

- A long-running summary pauses claim polling, so the panel may retain the last
  observation until that job finishes. The observation timestamp keeps this
  visible instead of implying real-time streaming.
- Codex may omit the weekly bucket or change the schema. Validation then reports
  unavailable and leaves summary execution unchanged.

## Migration Plan

1. Deploy the control plane first so old workers remain compatible.
2. Rebuild/recreate the summary worker so it begins reporting snapshots.
3. Verify admin authorization, live seven-day values, mount isolation, and an
   unavailable fixture.

## Source

- OpenAI Codex app-server auth/account API:
  <https://developers.openai.com/codex/app-server/#auth-endpoints>
