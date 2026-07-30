## 1. OpenSpec architecture and contract
- [x] 1.1 Add `design.md` covering explicit Responses configuration, `store: false`, exact output concatenation, strict status/usage, finite socket-operation timeout, no hidden provider retry, usage/pricing semantics, rollout/rollback schema compatibility, and archive order.
- [x] 1.2 Update the proposal to cover summary, punctuation, and cloud usage governance and mark the endpoint-value migration as breaking.
- [x] 1.3 Keep summary behavior in `meeting-summary-generation` and move punctuation behavior into the new `transcript-punctuation-restoration` capability.
- [x] 1.4 Add cloud-governance deltas for independent punctuation usage, lease-attempt idempotency, settlement ordering, lossless usage, unpriced models, and conservative legacy migration.

## 2. Existing Responses migration baseline
- [x] 2.1 Add `azure_openai_responses.py` with a focused request function using `model`, `instructions`, `input`, and `api-key`.
- [x] 2.2 Concatenate every string-valued `message` → `output_text` fragment exactly in response order while skipping `reasoning` items.
- [x] 2.3 Route Azure summary generation through the shared Responses transport, parse structured output, map top-level input/output/total usage, and fail on empty output.
- [x] 2.4 Route punctuation chunks through the shared Responses transport while preserving the fidelity guard and raw fallback.
- [x] 2.5 Update `.env.example` for the explicit Responses URL shape and the Luna deployment model.

## 3. Responses contract hardening
- [x] 3.1 Require an explicit Responses endpoint/key and remove or reject the legacy derived `chat/completions` fallback.
- [x] 3.2 Add `store: false` to both summary and punctuation request payloads and assert it in tests.
- [x] 3.3 Require `status=completed`; add multi-item/multi-part ordered-concatenation tests and reject incomplete, failed, or empty summary responses.
- [x] 3.4 Add a configurable finite socket-operation timeout and prove that punctuation and non-400 summary failures do not retry; the later `improve-uploaded-meeting-note-quality` change owns the one identical summary HTTP 400 retry.
- [x] 3.5 Validate non-negative integer input/output/total tokens without defaulting missing usage to zero; preserve cached-input and reasoning token details.
- [x] 3.6 Preserve punctuation metered subtotals and report how many provider calls were unmetered.
- [x] 3.7 Reject schema-incomplete Azure summary JSON while preserving valid provider usage on the failure callback.

## 4. Punctuation-stage and lifecycle accounting
- [x] 4.1 Add `punctuation` to the cloud stage domain, persistence schema, callback payloads, APIs, and reports without merging it into transcription or summary.
- [x] 4.2 Store cloud attempts by `(jobId, stage, leaseToken)` and make repeated callbacks for the same token idempotent.
- [x] 4.3 Append any reported attempt usage before lifecycle mutation or stale/cancelled callback rejection, and fail without fabricating invalid quota/pricing settlement identity.
- [x] 4.4 Count real usage from distinct superseded lease attempts once per token while preventing stale artifacts or lifecycle updates.
- [x] 4.5 Persist input/output/total/cached-input/reasoning token subtotals plus punctuation request/fallback/unmetered counts.
- [x] 4.6 Persist scheduler-issued transcription/summary token evidence and reject missing or never-issued cloud terminal tokens before settlement.
- [x] 4.7 Apply terminal lifecycle/artifact mutations through an atomic active-lease compare-and-save after settlement.

## 5. Honest pricing and reporting
- [x] 5.1 Price only an exact provider/model match with required authoritative provenance (base model/version, SKU or tier, currency, effective date, and meter source).
- [x] 5.2 Store `costUsd: null` and `pricingStatus: unpriced` for Luna while no official exact price exists; forbid fallback or estimated-reservation prices.
- [x] 5.3 Exclude unpriced records from actual USD totals while exposing their attempt count and token volume separately.
- [x] 5.4 Migrate legacy ledger values without authoritative meter identity to unpriced/null without fabricating token data.
- [x] 5.5 Reject pricing rows with blank deployment/pricing identity, malformed dates, ambiguous SKU/tier identity, missing provenance, or non-finite/negative rates.
- [x] 5.6 Add the verified Luna Global Standard and MAI Transcribe Fast Transcription catalog rows.
- [x] 5.7 Reprice fully metered historical rows in reporting without mutating the immutable ledger, and expose partial metered costs only as lower bounds.

## 6. Verification and deployment
- [x] 6.1 Run the pre-hardening Responses unit baseline (7 targeted worker tests pass on 2026-07-15).
- [x] 6.2 Run the pre-hardening affected control-plane baseline (5 files, 23 tests pass on 2026-07-15).
- [x] 6.3 Add worker regression tests for explicit config, `store: false`, completed status, ordered output, strict usage, socket-operation timeout, and no hidden provider retry.
- [x] 6.4 Add control-plane migration and integration tests for punctuation-stage accounting, lease-token idempotency, settlement-before-lifecycle, unmetered request counts, conservative legacy migration, and unpriced reporting.
- [x] 6.5 Run the complete worker and control-plane suites after the final corrective implementation (393 tests pass on 2026-07-15: control-plane 282, recording worker 13, external Python package 2, transcription worker 96; build also passes).
- [ ] 6.6 Deploy in the design order and capture durable redacted evidence for separate summary/punctuation attempts, runtime config, zero duplicate settlements, and unpriced Luna output.
- [ ] 6.7 Exercise pre-migration abort and post-migration feature rollback with the schema-aware control-plane; do not mix a chat endpoint with Responses callers or restore unverified previous binaries.
- [ ] 6.8 Resolve and rebase the active-change archive order documented in `design.md` before archiving.
- [x] 6.9 Run `openspec validate update-cloud-summary-azure-responses --strict --no-interactive` after the OpenSpec artifact update; rerun it after implementation changes.
- [x] 6.10 Add configurable socket-operation timeouts for Azure transcription and transcription/summary worker-to-control-plane HTTP calls, with regression tests.
