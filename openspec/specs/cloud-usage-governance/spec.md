# cloud-usage-governance Specification

## Purpose
Define how cloud-routed stages reserve, settle, and de-duplicate billable usage so retries and partial completion do not corrupt quota or cost accounting.
## Requirements
### Requirement: Reservation lasts through final billable stage settlement
The system SHALL keep reserved cloud quota in effect until every configured billable stage for a job has either written actual usage or reached an explicit terminal no-charge outcome.

#### Scenario: Cloud summary is still pending after cloud transcription settles
- **WHEN** a job has already written actual cloud transcription usage
- **AND** the same job still has a pending cloud summary stage
- **THEN** the remaining reservation needed for summary stays unavailable to later submissions
- **AND** quota release waits for the summary stage to settle or fail explicitly

#### Scenario: All configured billable stages are terminal
- **WHEN** every configured billable stage on a job has written actual usage or reached explicit no-charge terminal status
- **THEN** the system may fully settle the job's reservation
- **AND** any unused reserved amount is released exactly once

### Requirement: Idempotent cloud usage settlement
The system SHALL make actual cloud usage writes and reservation settlement idempotent across retried stage callbacks.

#### Scenario: Duplicate stage callback is retried after success
- **WHEN** a transcript or summary completion callback is delivered more than once
- **THEN** the system does not append duplicate actual cloud usage for that stage
- **AND** the job's settled cloud cost remains stable
