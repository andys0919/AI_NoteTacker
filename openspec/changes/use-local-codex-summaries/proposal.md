# Change: Route summaries through Local Codex by default

## Why

Azure-hosted Luna is no longer wanted as a selectable primary summary route.
The existing summary worker supports Codex CLI with a dedicated ChatGPT
workspace login, so new jobs should snapshot and claim only Local Codex.

The user approved this switch on 2026-08-06 and the runtime identity isolation
on 2026-08-07: keep `gpt-5.6-luna` with `max` reasoning, store the worker login
only in its dedicated Docker volume, and do not add an OAuth token input or call
subscription usage `$0`.

## What Changes

- Make `local-codex` the only selectable and claimable summary provider.
- Run the primary summary path through Codex CLI using `gpt-5.6-luna` and
  `reasoning.effort=max`.
- Mount only the dedicated `summary_codex_home` volume into the summary worker;
  never mount the host user's default Codex home into a product container.
- Retire Azure summary readiness and selection from the control plane and show
  the fixed Local Codex primary route as read-only UI status.
- Keep Azure Speech/MAI transcription unchanged.
- Keep historical Azure summary ledger rows and their verified price catalog
  readable, but stop refreshing Luna retail prices for new work.
- Treat Codex subscription summaries as non-cloud work without recording a
  fabricated zero-dollar actual-cost row.

The later `add-azure-summary-quota-fallback` change keeps this primary-route
cutover and restores Azure only as an internal explicit-quota fallback.

## Impact

- Affected specs: `meeting-summary-generation`, `cloud-usage-governance`,
  `deployment-readiness`
- Affected code: control-plane provider policy/catalog, summary worker, Compose,
  admin UI, pricing refresh, tests, README, and HANDOFF
- Migration: a persisted active Azure summary policy is normalized to
  `local-codex`; completed historical jobs and ledger records are unchanged
