## Context

The summary and punctuation callers previously used Azure
`chat/completions`. The target Azure AI Foundry resource exposes
`gpt-5.6-luna` through `/openai/v1/responses`, whose request, response, and
usage contracts differ. Both calls are cloud-billable, but punctuation is
currently embedded in transcription and therefore lacks its own accounting
boundary.

The first implementation established a shared Responses transport, but its live
checks were not retained as durable evidence. This design closes the remaining
correctness and governance gaps before archive and requires a new redacted live
verification: explicit configuration, disabled Responses application-state and
message-history storage, strict status/output/usage handling, finite
socket-operation timeouts, attempt-aware settlement, and honest unpriced
reporting.

No official exact price for the Azure deployment named `gpt-5.6-luna` is
available in the repository's authoritative pricing sources. A price from a
different OpenAI or Azure model is not evidence for Luna pricing.

The `model` field sent to Azure is a deployment name, not sufficient billing
identity by itself. A future catalog row must be backed by the deployment's
verified base model/version, SKU or service tier, currency, effective date, and
meter source. The inference API key available to the workers cannot read that
subscription billing metadata.

The existing `gpt-4o-transcribe` callback reports audio duration only, while
Azure publishes separate audio-input, text-input, and text-output token meters.
Duration remains useful for reservation estimation but cannot produce exact
actual transcription cost.

## Goals / Non-Goals

**Goals:**
- Define one strict Responses transport contract shared by summary and
  punctuation.
- Keep summary generation fail-fast while keeping punctuation best-effort and
  fidelity guarded.
- Account for punctuation independently from transcription and summary.
- Preserve provider usage exactly and make each lease attempt idempotent.
- Represent unknown USD price honestly, including legacy rows whose meter
  identity cannot be reconstructed.
- Make deployment and rollback explicit across code, configuration, runtime
  policy, and the post-migration schema compatibility floor.

**Non-Goals:**
- Decouple summary and punctuation onto separate Azure resources in this change.
- Add an SDK dependency or enable Responses application-state/message-history
  storage.
- Invent, scrape, or infer a Luna price.
- Reconstruct historical token usage or meter identity that was never stored.
- Add automatic retries inside the shared Responses transport. The later
  `improve-uploaded-meeting-note-quality` change permits one summary-caller
  retry for HTTP 400 only.

## Decisions

### 1. Require an explicit Responses endpoint and key

`AZURE_OPENAI_SUMMARY_ENDPOINT` must contain the complete Responses URL and
`AZURE_OPENAI_SUMMARY_API_KEY` must contain its key before either caller is
enabled. Punctuation may continue to use those explicitly configured values in
this change, but neither caller may derive a legacy `chat/completions` URL from
the generic Azure transcription endpoint.

Keeping the variable names limits deployment churn, but their endpoint value is
not backward compatible. A chat endpoint and the new worker code cannot be
mixed.

Alternative considered: derive `/openai/v1/responses` from a resource base URL.
Rejected because the existing variables contain several endpoint shapes and an
incorrect derivation would fail only at runtime.

### 2. Disable Responses application-state storage explicitly

Every request sends exactly the configured `model`, `instructions`, `input`,
and `store: false`, authenticated with `api-key`. This disables storage of
Responses application state and message history rather than relying on the
provider default. It is not a zero-data-retention guarantee and does not govern
separate abuse-monitoring retention; those controls must be assessed against
the Azure resource's data-privacy configuration.

### 3. Validate status, concatenate output deterministically, and require usage

Only `status=completed` is successful. Output extraction traverses `output` in
array order, selects only `type=message`, then selects every string-valued
`type=output_text` content part in content order. The exact fragments are
concatenated without inserting characters, and only the final aggregate is
trimmed. `reasoning` and every other item type are ignored.

Summary additionally requires non-empty extracted text and the complete Azure
Responses usage shape: non-negative integer `input_tokens`, `output_tokens`,
`total_tokens`, `input_tokens_details.cached_tokens`, and
`output_tokens_details.reasoning_tokens`. Missing or malformed usage is a failed
summary attempt; zero is never used as a substitute for a missing required
field. Its parsed JSON must contain all six configured summary fields: a
non-empty string `summary` and string-array `key_points`, `action_items`,
`decisions`, `risks`, and `open_questions`. A JSON object that merely parses but
omits or mistypes those fields is a failed summary attempt; valid provider usage
from that failed attempt is still settled.

Punctuation applies the same status/output rules, but any invalid result keeps
the raw chunk under the existing fidelity guard.

Alternative considered: accept partial output from an incomplete response.
Rejected because a partial JSON summary is unsafe to persist and partial
punctuation cannot be distinguished reliably from a truncated rewrite.

### 4. Bound worker network operations and avoid unbounded provider retry

Each HTTP request receives an explicit configurable `urlopen` timeout for
blocking connection/socket operations. It bounds an individual blocking
operation but is not a guaranteed end-to-end wall-clock deadline. A timeout is
a terminal result for that provider call. The shared Responses transport does
not retry provider calls. The summary caller may make the one
identical-payload HTTP 400 retry defined by
`improve-uploaded-meeting-note-quality`; punctuation, timeouts, and every other
failure remain single-call. Request and unmetered-request counts keep that
bounded exception attributable within the scheduler-issued summary lease.

The same finite blocking-operation rule applies to Azure transcription uploads
and the transcription/summary workers' control-plane claim, read, heartbeat,
and callback calls. This prevents a blocked socket from holding either Python
worker or its heartbeat forever. These timeouts do not add hidden Azure
provider retries.

### 5. Treat punctuation as a separate cloud stage

The accounting stages are `transcription`, `punctuation`, and `summary`.
Punctuation can remain physically adjacent to Azure transcription in the
worker, but it emits its own attempt identity, outcome, and usage metadata. A
raw-text fallback does not erase a provider call or merge its tokens into the
transcription entry.

### 6. Authenticate issued attempts and settle before an atomic lifecycle mutation

The idempotency key is `(jobId, stage, leaseToken)`. Every scheduler assignment
also persists append-only evidence that the token was issued for that job and
stage. Cloud terminal callbacks require a token even when they carry no usage;
a missing or never-issued token is rejected before ledger or lifecycle mutation.
A callback carrying cloud usage first appends that attempt's immutable
usage/pricing entry, then applies the authorized lifecycle or artifact mutation.
This ordering is deliberately not described as a cross-repository database
transaction: if append fails, the lifecycle is unchanged; if the later
lifecycle save fails, retry observes the same immutable entry and can finish the
save without duplicating usage.

Repeated callbacks with the same lease token and payload return the original
entry without duplicating usage; a different payload for the same key is a
conflict rather than a mutable correction. A superseded or cancelled lease may
have incurred real punctuation usage, so reported usage is settled once under
its own token before the stale lifecycle/artifact mutation is rejected.

If reported usage requires settlement but the job's quota-day is not a valid
`YYYY-MM-DD` calendar date or its pricing version is missing/blank, the callback
fails explicitly before ledger or lifecycle mutation. The control-plane does
not silently accept the callback or fabricate either identity.

After settlement, lifecycle/artifact persistence compares the active lease
token atomically at the repository boundary. A cancellation or replacement
lease installed while append is in flight makes that compare fail, leaving the
newer job state untouched while retaining the old issued attempt's settled
usage. Re-reading a job without an atomic compare-and-save is insufficient
because another claim can occur between the read and save.

The worker may resend an identical terminal control-plane callback once when
its first delivery fails. That delivery retry does not repeat the Azure
provider call and must not convert a successful provider result into a
contradictory failure callback.

### 7. Preserve usage and separate metering from pricing

For fully metered Responses calls, attempt metadata includes `inputTokens`,
`outputTokens`, `totalTokens`, `cachedInputTokens`, and `reasoningOutputTokens`.
Punctuation is best effort and can span several calls, so its metadata also
stores request, accepted, fallback, and unmetered-request counts. Token totals
cover the metered calls only; a non-zero unmetered count prevents those totals
from being mistaken for complete provider metering.

Pricing is a second decision. A catalog entry is usable only after its deployment
name has been tied to verified base model/version, SKU or tier, currency,
effective date, and meter source. When that authoritative entry matches the
event's model and pricing version, the attempt receives `pricingStatus=priced`
and a calculated `costUsd`. Otherwise it receives `pricingStatus=unpriced` and
`costUsd=null`. An estimated reservation remains distinguishable from actual
cost and cannot be used as a fallback price. The current Responses catalog is
empty because no such Luna identity/rate evidence is available. A punctuation
aggregate with any unmetered request also remains unpriced even if a future
token rate exists, because its metered token subtotal is not the complete billed
quantity.

Mechanical catalog validation rejects blank deployment model or pricing
version, non-USD currency, malformed effective dates, missing provenance,
both-or-neither SKU/tier identity, and non-finite or negative rates. This
validation cannot prove that operator-entered Azure billing identity is truthful
or still current; activating a row still requires the documented
deployment/Cost Details verification and a new configuration review.

### 8. Migrate unverifiable historical cost conservatively

Existing ledger rows do not retain enough deployment/meter identity to prove
their duration- or fixed-rate values as actual Azure cost. The migration keeps
those rows for audit but sets `pricingStatus=unpriced` and `costUsd=null` rather
than guessing which historical values were authoritative. It does not fabricate
missing token or lease metadata.

Issued transcription/summary token histories are added as internal persistence
fields. New claims append their token atomically with the assignment. Schema
initialization backfills any active pre-migration token into an empty history,
and the current-token check also keeps that in-flight rollout boundary
acceptable. The deployment sequence first stops new claims while keeping the
old control-plane available for callbacks, drains or explicitly handles old
in-flight work, and only then stops the old control-plane before relying on
history for superseded settlement.

### 9. Deploy and roll back atomically

Forward deployment order:
1. Stop new claims and provider routing while keeping the old control-plane
   available to accept callbacks for already-issued attempts; drain or
   explicitly handle those attempts before stopping the old control-plane.
2. Rotate the exposed Responses key before any new provider call or deployment,
   then stop every old control-plane instance so no old binary can issue a lease
   after the one-time active-token backfill. Apply the database migration and
   deploy control-plane code that understands the new stage, issued-token
   history, lease-attempt, metadata, and nullable pricing fields.
3. Configure the explicit Responses endpoint/key, timeout, and model without
   activating Luna routing yet.
4. Build and deploy both worker images with `store: false`, strict validation,
   and punctuation-stage callbacks.
5. Verify worker/control-plane compatibility, then switch the runtime summary
   and punctuation model/provider policy.
6. Run a durable redacted live verification before declaring the rollout done.

Before the database migration starts, abort may restore the previous immutable
worker/control-plane bundle and its compatible endpoint values. After migration,
rollback first stops new claims, drains or explicitly handles in-flight leases,
and switches summary, punctuation, and cloud transcription to compatible
local/disabled policy while retaining the schema-aware control-plane and current
workers. The previous control-plane cannot run against the migrated ledger: its
INSERT omits the now-required `pricing_status`, and its reader treats nullable
cost as a numeric zero. Previous workers likewise require a separately tested
callback-compatible image before they can be used with the strict callback
schema. Additive database fields and recorded attempts remain in place.

A post-migration full-code rollback therefore requires a separately built and
exercised compatibility release that understands nullable pricing, issued-token
history, and the current callback schema. No such release is claimed here;
verification task 6.7 remains open. A chat endpoint may return only with a
pre-migration abort bundle, never while Responses callers are running.

### 10. Resolve active-change archive order before archiving

Several active changes overlap these capabilities. Archive the foundational
summary and governance changes before this change:
1. `add-codex-transcript-summaries` establishes the
   `Transcript-derived meeting summaries` requirement.
2. Rebase and archive `add-cloud-usage-governance` so its MODIFIED summary
   requirement includes the then-current complete requirement and its ledger
   requirements become published truth.
3. Revalidate this change against those published specs, preserving the full
   MODIFIED cloud-governance requirements in this delta, then archive this
   change.
4. Rebase `add-admin-summary-model-switch` and
   `add-operator-productivity-workflows` after the preceding archives so neither
   later MODIFIED delta drops routing, usage, or Responses scenarios.

CLI strict validation is necessary but does not detect these semantic archive
order conflicts.

## Risks / Trade-offs

- Per-chunk Luna punctuation calls can extend transcription completion. The
  finite socket-operation timeout and raw fallback limit each blocking
  operation, while attempt usage remains visible.
- No unbounded provider retry reduces surprise cost. The one later-approved
  summary HTTP 400 replay records provider/unmetered request counts; every other
  new provider attempt still requires a new scheduler-issued lease. A one-time
  identical terminal callback delivery retry does not call the provider again.
- Unpriced usage makes USD totals incomplete. Reports must surface the unpriced
  count/token volume and must not present partial USD totals as total spend.
- Sharing explicit summary credentials with punctuation remains coupling. It is
  accepted for this rollout and can be separated by a later proposal.
- Settlement ordering adds control-plane schema and retry complexity.
  Lease-token idempotency and integration tests are required before activation.

## Migration Plan

Use the forward deployment and rollback sequences in Decision 9. The migration
must be additive, and old control-plane/worker combinations must not be allowed
to run against the migrated schema unless packaged and tested as a compatibility
release. Its active-token backfill can recover only leases that are still
present when schema initialization runs; already-cleared pre-migration leases
cannot be reconstructed. Preserve legacy ledger rows as unpriced rather than
backfilling unverifiable actual cost.

Before archive, run strict OpenSpec validation, worker contract tests,
control-plane settlement/lifecycle tests, and one redacted live flow that proves
summary and punctuation usage are separate and Luna remains unpriced when no
official price exists.

## Open Questions

No unresolved design questions remain for approved plan A. Separate Azure
credentials for punctuation and a future official Luna price require later
explicit changes rather than implicit behavior in this rollout.
