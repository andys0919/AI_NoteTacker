## MODIFIED Requirements
### Requirement: Idempotent cloud usage settlement
The system SHALL identify reported cloud usage by job, stage, and lease token,
and SHALL keep that attempt's ledger payload immutable across retried or stale
callbacks.

#### Scenario: Duplicate callback repeats the same usage payload
- **WHEN** a callback reports the same job, stage, lease token, and usage payload more than once
- **THEN** the system returns the original ledger entry
- **AND** it does not duplicate tokens, cost, artifacts, or lifecycle transitions

#### Scenario: Duplicate key carries a different usage payload
- **WHEN** a callback reuses the same job, stage, and lease token with different usage or pricing data
- **THEN** the system reports an idempotency conflict
- **AND** it does not mutate the first ledger entry

#### Scenario: Superseded lease reports provider usage
- **WHEN** a callback from an older superseded lease reports provider usage after a newer lease became authoritative
- **THEN** the older lease's provider usage is settled at most once under its own stage and lease token
- **AND** the stale callback does not overwrite the authoritative artifact or lifecycle state
- **AND** usage from distinct lease attempts is not collapsed into one entry

#### Scenario: Cloud terminal callback omits its lease token
- **WHEN** a cloud transcription or cloud summary success or failure callback omits the scheduler-issued lease token, whether or not it carries usage
- **THEN** the callback is rejected before usage or lifecycle mutation
- **AND** the system does not substitute a shared legacy idempotency key

#### Scenario: Terminal callback supplies a token the scheduler never issued
- **WHEN** a cloud terminal callback supplies a non-empty token that was never issued for that job and stage
- **THEN** the callback is rejected before usage or lifecycle mutation
- **AND** changing the fabricated token cannot create additional ledger entries

## ADDED Requirements
### Requirement: Reported provider usage settles before lifecycle mutation
The system SHALL append any cloud usage carried by a worker callback before it
saves the related lifecycle or artifact mutation or returns early because the
callback was cancelled, superseded, or duplicated.

#### Scenario: Usage append fails
- **WHEN** a terminal callback carries cloud usage and the ledger append fails
- **THEN** the related lifecycle or artifact mutation is not saved
- **AND** retry can settle the usage before completing the mutation

#### Scenario: Reported usage has invalid settlement identity
- **WHEN** a callback reports usage that requires settlement but its job has a missing, blank, or invalid-calendar quota-day key or a missing/blank pricing version
- **THEN** the callback fails explicitly before ledger or lifecycle mutation
- **AND** the system does not fabricate the missing settlement identity

#### Scenario: Cancelled or superseded callback carries punctuation usage
- **WHEN** a cancelled or superseded transcription lease reports punctuation usage already incurred
- **THEN** the punctuation usage is appended once under that lease token
- **AND** the callback does not replace the current artifact or lifecycle state

#### Scenario: Active lease changes while usage append is in flight
- **WHEN** a callback begins settling an issued attempt and a cancellation or replacement lease is persisted before its lifecycle/artifact save
- **THEN** the old attempt's reported usage remains settled once
- **AND** an atomic active-lease compare prevents the old callback from overwriting the newer lease, state, or artifact

#### Scenario: First terminal callback delivery fails
- **WHEN** the provider call has finished and the first terminal callback delivery fails
- **THEN** the worker resends the exact same terminal payload once
- **AND** it does not repeat the provider call
- **AND** it does not convert a successful provider result into a contradictory failure callback

#### Scenario: Transcription fails after earlier successful cloud uploads
- **WHEN** one or more cloud transcription uploads succeeded before a later chunk or retry caused the lease attempt to fail
- **THEN** the failure callback preserves the duration of every successful provider upload for settlement
- **AND** that partial transcription usage remains unpriced until billed token quantities and authoritative meter identity are available

### Requirement: Transcript punctuation is an independent cloud usage stage
The system SHALL account for cloud transcript punctuation under the stage name
`punctuation`, independently from `transcription` and `summary`.

#### Scenario: Punctuation succeeds after cloud transcription
- **WHEN** a cloud punctuation attempt returns provider usage
- **THEN** the ledger records that usage under `stage=punctuation`
- **AND** the usage is not merged into transcription or summary usage

#### Scenario: Best-effort punctuation falls back to raw text
- **WHEN** one or more punctuation calls fail validation and the transcript keeps raw chunks
- **THEN** the punctuation entry preserves the metered token subtotal from successful provider responses
- **AND** it records request, accepted, fallback, and unmetered-request counts
- **AND** the best-effort fallback does not hide provider usage already incurred

### Requirement: Responses usage metadata remains lossless
The system SHALL preserve complete provider-reported Responses token details and
SHALL distinguish a metered subtotal from punctuation calls whose usage could
not be read.

#### Scenario: Provider returns complete token metadata
- **WHEN** the Responses API returns valid usage for a cloud call
- **THEN** the usage record stores `inputTokens`, `outputTokens`, and `totalTokens`
- **AND** it stores `cachedInputTokens` and `reasoningOutputTokens`
- **AND** cached input remains a subset of input and reasoning output remains a subset of output

#### Scenario: A punctuation request has no readable provider usage
- **WHEN** a punctuation request fails before valid usage can be extracted
- **THEN** the aggregate increments `unmeteredRequestCount`
- **AND** its token totals continue to represent only calls with complete provider usage
- **AND** reports do not present the metered subtotal as complete metering for the attempt

### Requirement: Unpriced model usage is not fabricated as actual USD
The system SHALL calculate USD cost only from an authoritative configured price
for the exact model and pricing version, and SHALL preserve measured but
unpriced usage without substituting another price.

#### Scenario: Exact authoritative price is configured
- **WHEN** a metered Responses attempt has a configured price whose deployment name, base model/version, SKU or tier, currency, effective date, and meter source were verified and whose model and pricing version match the event
- **THEN** cached input and uncached input use their respective rates
- **AND** a model with billable cache writes is complete only when cache-write tokens and their rate are present
- **AND** output tokens are charged once without adding reasoning tokens a second time
- **AND** the ledger stores the calculated `costUsd` with `pricingStatus=priced`

#### Scenario: Configured price row is mechanically invalid
- **WHEN** a candidate price has a blank deployment model or pricing version, malformed effective date, missing provenance, both or neither SKU/tier identity, or a non-finite or negative token rate
- **THEN** the candidate is rejected and usage remains `pricingStatus=unpriced` with `costUsd=null`
- **AND** shape validation is not described as proof that operator-supplied billing identity is authoritative

#### Scenario: Verified Luna Global Standard price is configured
- **WHEN** the exact `gpt-5.6-luna` deployment is model version `2026-07-09`, SKU `GlobalStandard`, and pricing version `v1`
- **THEN** the system configures short-context input at USD 1.00/M tokens, cached input at USD 0.10/M tokens, cache writes at USD 1.25/M tokens, and output at USD 6.00/M tokens
- **AND** the catalog records the official Microsoft meter source and effective date

#### Scenario: OpenAI direct pricing differs from Azure pricing
- **WHEN** OpenAI publishes a different direct API price for `gpt-5.6-luna` while the deployed provider remains Azure Global Standard
- **THEN** the system continues using the exact Azure Retail Prices API meters for that deployment
- **AND** it does not substitute the direct OpenAI price until Microsoft publishes a matching Azure meter change

#### Scenario: Luna usage omits cache-write quantity
- **WHEN** Azure reports Luna input, cached-input, and output tokens but omits the separately billable cache-write token quantity
- **THEN** the immutable attempt remains `pricingStatus=unpriced` with `costUsd=null`
- **AND** reporting exposes the input/cached-input/output calculation as a known lower bound
- **AND** the cache-write remainder stays visibly unpriced

#### Scenario: Exact model price remains unknown
- **WHEN** an attempt has no authoritative configured price matching its model and pricing version
- **THEN** the ledger stores `costUsd: null` with `pricingStatus=unpriced`
- **AND** it does not use a price from another model, a guessed price, or an estimated reservation

#### Scenario: Punctuation metering is incomplete
- **WHEN** a punctuation aggregate has one or more unmetered requests even if a matching token rate is configured
- **THEN** the complete attempt cost remains `costUsd: null` with `pricingStatus=unpriced`
- **AND** reporting prices the complete token subtotal as a known lower bound
- **AND** the unmetered remainder remains visible and the lower bound is not presented as complete billed usage

#### Scenario: MAI Transcribe uses the verified Fast Transcription meter
- **WHEN** `azure-speech-mai-transcribe-1.5` reports audio duration for model `mai-transcribe-1.5` under pricing version `v1`
- **THEN** the system prices that duration using the verified Southeast Asia Azure Speech Fast Transcription rate of USD 0.36 per audio hour
- **AND** the meter source, region, SKU, unit, and effective date remain documented

#### Scenario: Historical MAI row used the superseded S1 rate
- **WHEN** an immutable historical MAI row preserves complete audio duration but stores cost calculated at USD 1.00 per audio hour
- **THEN** reporting derives its known cost at the verified USD 0.36 Fast Transcription rate
- **AND** the immutable ledger row is not updated

#### Scenario: Transcription callback reports duration without billed tokens
- **WHEN** a `gpt-4o-transcribe` callback reports `audioMs` but not the provider's billed audio-input, text-input, and text-output tokens and meter identity
- **THEN** its actual ledger entry is unpriced with `costUsd: null`
- **AND** a duration-based reservation estimate is not relabeled as actual cost

#### Scenario: A report includes unpriced usage
- **WHEN** one or more actual ledger entries are unpriced
- **THEN** the report exposes the known priced subtotal and an unpriced-usage indicator
- **AND** the complete actual USD total is null rather than a partial subtotal presented as total spend

#### Scenario: An historical row becomes priceable
- **WHEN** an immutable historical row is unpriced but preserves a complete meter that now matches an authoritative catalog entry
- **THEN** reporting derives its current known cost without updating the ledger row
- **AND** fully metered usage no longer appears unpriced in the reporting view
- **AND** partially metered usage keeps the unpriced indicator and exposes only a lower bound

#### Scenario: Legacy rows lack authoritative meter identity
- **WHEN** the nullable-pricing migration encounters an existing ledger row whose former numeric value cannot be tied to an authoritative meter
- **THEN** the row is retained with `pricingStatus=unpriced` and `costUsd=null`
- **AND** the migration does not fabricate historical token or lease metadata

### Requirement: Verified Azure retail prices refresh daily
The system SHALL refresh the exact Azure public PAYG meters used by the deployed
Luna and MAI providers plus the TWD reference meter at startup and every 24
hours without replacing a valid catalog with incomplete or not-yet-effective
data.

#### Scenario: Complete currently effective snapshot is returned
- **WHEN** Azure Retail Prices API returns one consistent USD Consumption rate for every required Luna Global Standard short-context meter plus complete USD and TWD rows for the verified Southeast Asia MAI Fast Transcription meter
- **AND** their effective dates are not later than the current time
- **THEN** the system atomically applies the USD rates to subsequent cost calculations and the derived positive USD-to-TWD rate to display configuration
- **AND** records the official query as meter provenance

#### Scenario: Refresh cannot prove a complete price snapshot
- **WHEN** the API request fails, times out, paginates unexpectedly, omits a required meter, returns conflicting regional rates, has a wrong currency/SKU/unit, or contains only future-effective rows
- **THEN** the system keeps the last verified catalog unchanged
- **AND** it does not substitute zero, a partial response, OpenAI direct pricing, or an estimated reservation

#### Scenario: Control plane remains running for another day
- **WHEN** 24 hours have elapsed since the previous scheduled refresh attempt
- **THEN** the system starts one new bounded Azure Retail Prices API refresh
- **AND** it does not require a process restart or operator action

### Requirement: Cloud worker blocking network operations are finitely bounded
The system SHALL configure finite socket-operation timeouts for Azure cloud
calls made by the transcription/summary workers and for those workers'
control-plane calls so an indefinitely blocked network operation cannot hold a
worker or heartbeat forever.

#### Scenario: Azure transcription socket operation stalls
- **WHEN** an Azure transcription connection or socket operation exceeds its configured timeout
- **THEN** the provider attempt fails explicitly
- **AND** any usage already reported by earlier successful uploads remains available to the terminal callback

#### Scenario: Control-plane callback or heartbeat socket operation stalls
- **WHEN** a transcription or summary worker claim, read, heartbeat, or callback connection/socket operation exceeds its configured timeout
- **THEN** that operation raises a timeout instead of blocking forever
- **AND** a terminal callback may use only its documented exact-payload delivery retry, without repeating provider work
