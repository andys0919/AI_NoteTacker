## ADDED Requirements

### Requirement: Azure fallback usage is attributed to the actual provider

The system SHALL distinguish a job's `local-codex` primary route from the
provider that actually executed its summary. Every terminally reported Azure
fallback SHALL be settled as `azure-openai` under the scheduler-issued summary
lease; Local Codex work SHALL not create an Azure usage entry.

#### Scenario: Azure fallback summary succeeds

- **WHEN** an Azure fallback stores a valid summary with complete token usage
- **THEN** the ledger writes one idempotent `azure-openai` summary actual entry for that lease
- **AND** pricing uses the fallback model and actual token details

#### Scenario: Azure fallback request fails without trustworthy token counts

- **WHEN** the one allowed Azure request fails and token usage cannot be recovered
- **THEN** the ledger preserves one unmetered Azure provider request
- **AND** the cost remains explicitly unpriced rather than fabricated as zero

#### Scenario: Local Codex completes normally

- **WHEN** the primary Local Codex summary succeeds
- **THEN** no Azure summary usage entry is written
- **AND** the job remains attributed to its `local-codex` primary route

#### Scenario: Worker dies after reserving fallback

- **WHEN** a worker dies after the job-scoped Azure reservation but before a trustworthy terminal callback
- **THEN** the reservation remains as audit evidence and blocks another Azure request
- **AND** the system does not fabricate token usage or a zero-dollar actual charge

#### Scenario: Fallback fails before provider contact

- **WHEN** the reserved Azure path fails before its request audit start is durably accepted
- **THEN** the terminal failure omits Azure provider attribution, usage, and request IDs
- **AND** the reservation remains as the only audit evidence without creating an Azure actual row

#### Scenario: Terminal callback mixes providers

- **WHEN** a summary terminal callback names request audits from a provider other than its actual provider
- **THEN** the callback is rejected before usage or lifecycle mutation

#### Scenario: Azure fallback omits its request audit

- **WHEN** an Azure fallback terminal callback reports provider attribution or usage without its finalized request audit ID
- **THEN** the callback is rejected before usage or lifecycle mutation
- **AND** no legacy aggregate charge is fabricated from the untrusted callback
