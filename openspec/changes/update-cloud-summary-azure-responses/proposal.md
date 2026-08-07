# Change: Harden Azure Responses Summary, Punctuation, and Usage Accounting

> **Superseded for active summary routing on 2026-08-06:**
> `use-local-codex-summaries` removes the Azure summary transport and live Luna
> price refresh. The accounting and schema work here remains historical
> compatibility for existing ledger rows.

## Why
The cloud meeting-AI pipeline is moving to `gpt-5.6-luna` on an Azure AI
Foundry resource that is exposed through the Responses API rather than the
legacy `chat/completions` API. Summary generation and transcript punctuation
therefore need a precise Responses request, response, socket-operation timeout,
and usage contract.

The first implementation proved the request path, but the change also crosses
cloud accounting and job lifecycle boundaries. Punctuation is a distinct
provider call and must not be hidden inside transcription usage. Responses
usage must remain faithful to provider metadata. An exact published model rate
may be applied only after its deployment identity is verified; any remainder
whose provider meter is missing must stay visibly unpriced instead of
inheriting or guessing a price.

## What Changes
- **BREAKING**: require an explicit Responses endpoint and key for these calls.
  Existing `chat/completions` endpoint values are not compatible and must be
  migrated atomically with the worker code.
- Send summary and punctuation requests with `{model, instructions, input,
  store: false}`; accept only `status=completed`, concatenate all assistant
  `output_text` parts in response order, and reject invalid, empty, or
  schema-incomplete summary responses.
- Apply an explicit configurable socket-operation timeout. Provider calls do
  not retry; the quota-only Azure summary fallback reserves and issues at most
  one provider request, including when that request returns HTTP 400.
- Keep transcript punctuation best-effort and fidelity-guarded, while defining
  it as its own `punctuation` cloud stage rather than summary or transcription
  usage.
- Preserve provider-reported input, output, cached-input, optional cache-write,
  reasoning, and total token metadata, and keep metered token subtotals distinct
  from punctuation requests whose usage could not be read.
- Make reported usage settlement attempt-aware and idempotent by lease token,
  and append usage carried by success, failure, cancellation, or superseded
  callbacks before applying or rejecting their lifecycle transition.
- Persist evidence of every scheduler-issued transcription/summary lease,
  reject missing or never-issued terminal tokens before settlement, and apply
  lifecycle/artifact mutations with an atomic active-lease compare-and-save so
  a callback cannot overwrite a concurrently installed lease or cancellation.
- Fail before lifecycle mutation when reported usage cannot be settled because
  its job has an invalid quota-day or missing/blank pricing-version identity.
- Bound Azure transcription and transcription/summary worker-to-control-plane
  blocking network operations with explicit configurable socket-operation timeouts.
- Configure the now-published `gpt-5.6-luna` Global Standard rates for the
  verified `2026-07-09` deployment, and configure MAI Transcribe 1.5 against
  the verified Azure Speech Fast Transcription hourly meter.
- Settle MAI from the sum of each successful upload rounded up to a whole billed
  second; keep retries or failed attempts with uncertain billing visibly
  unpriced while retaining the successful-upload subtotal.
- Refresh the exact MAI USD meter plus its exact TWD reference meter at
  control-plane startup and every 24 hours, accepting only a complete,
  internally consistent, currently effective Consumption snapshot and
  otherwise retaining the last verified catalog. Keep the historical Luna
  catalog source-attributed and checked in; do not refresh it for new work.
- Resolve historical unpriced rows from their preserved meter details at read
  time without mutating the immutable usage ledger. Preserve an unpriced flag
  when only a metered lower bound is known.
- Fail closed on malformed pricing rows, including blank deployment/pricing
  identity, invalid provenance dates, ambiguous SKU/tier identity, and
  non-finite or negative rates.
- Convert legacy duration/fixed-rate ledger values that lack authoritative meter
  identity to unpriced/null during migration instead of certifying them as actual.
- Establish a schema compatibility floor: after the nullable-pricing migration,
  feature rollback retains the schema-aware control-plane and workers with cloud
  routing disabled; previous binaries may return only before migration or as a
  separately tested compatibility release.

## Impact
- Affected specs:
  - `meeting-summary-generation`
  - `transcript-punctuation-restoration`
  - `cloud-usage-governance`
- Affected code:
  - Azure Responses request/response transport and configuration
  - Azure summary and punctuation callers
  - worker callbacks and stage usage payloads
  - control-plane cloud usage ledger, pricing, settlement, lifecycle handling,
    migrations, Azure retail-price refresh, APIs, and reports
  - related worker and control-plane tests
  - deployment configuration for the explicit Responses endpoint/key and model
- Operational impact: per-chunk `gpt-5.6-luna` punctuation calls may add
  transcription latency, and the endpoint/configuration migration must be
  deployed atomically.
