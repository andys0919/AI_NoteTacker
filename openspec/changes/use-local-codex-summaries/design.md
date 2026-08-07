## Context

Summary routing supports both Codex CLI and an Azure Responses transport.
Production stores the summary worker's ChatGPT login in a dedicated named
Docker volume; the host user's default Codex home is a separate identity and is
never mounted into the product container.

## Goals / Non-Goals

- Goals: one selectable summary route, isolated runtime identity, correct policy
  migration, honest billing, and a verifiable production cutover.
- Non-goals: changing Azure Speech/MAI transcription, deleting historical usage,
  accepting OAuth tokens in the web application, or changing the summary schema.

## Decisions

- Keep `SummaryProvider` able to represent historical `azure-openai` rows, but
  expose only `local-codex` in the active provider list and catalog.
- Normalize the singleton persisted policy when it contains a retired summary
  provider. Do not rewrite completed job snapshots or ledger entries.
- The existing Codex summarizer is the primary implementation and honors the
  job's latched summary model. The later `add-azure-summary-quota-fallback`
  change restores the Azure transport only behind structured quota exhaustion.
- Treat transcripts as untrusted input: pass the prompt on stdin, ignore user
  configuration and rules, disable every Codex command-execution backend, run
  from an empty temporary directory, and give the Codex subprocess only the
  small environment needed for login and TLS. In particular, do not pass the
  worker's internal service token. Apply a finite wall-clock timeout so a
  stalled CLI cannot renew its work lease forever.
- Keep the checked-in Azure Luna pricing row for historical report
  re-resolution and quota-fallback usage. The daily retail refresh fetches only
  Azure Speech/MAI and TWD reference meters.
- Keep the mounted Codex login state in the dedicated external
  `ai_notetacker_summary_codex_home` volume as a password-like runtime secret.
  The product never mounts the host user's default Codex home and never
  receives, displays, or stores a user-supplied OAuth token.

## Risks / Trade-offs

- ChatGPT subscription limits are not API billing. The later quota-fallback
  change permits Azure only from Codex's structured reached-limit state.
- A queued historical Azure summary snapshot would no longer be claimable.
  Before cutover, production must show no such pending work or migrate only the
  non-terminal snapshots to `local-codex`.

## Migration Plan

1. Verify there are no active summary leases or pending Azure summary jobs.
2. Authenticate the dedicated Codex volume and deploy the Local-Codex-only
   catalog and primary worker route without a host `CODEX_HOME` bind mount.
3. Let policy repository normalization persist `local-codex` for the singleton
   current policy.
4. Verify health, current policy, Codex login/model visibility, environment
   isolation, and one controlled local summary path when feasible.

The primary provider remains Local Codex after the later internal fallback is
added; Azure does not return to policy or UI selection.
