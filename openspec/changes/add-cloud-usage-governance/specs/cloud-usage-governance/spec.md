## ADDED Requirements
### Requirement: Append-only cloud usage ledger
The system SHALL maintain an append-only cloud usage ledger for billable transcription and summary stages.

#### Scenario: Cloud transcription writes actual usage
- **WHEN** a job completes cloud-routed transcription
- **THEN** the system appends a cloud usage ledger entry for the `transcription` stage
- **AND** the entry records the job id, submitter id, provider, model identifier, pricing version, measured usage quantity, usage unit, and USD amount

#### Scenario: Cloud summary writes actual usage
- **WHEN** a job completes cloud-routed summary generation
- **THEN** the system appends a cloud usage ledger entry for the `summary` stage
- **AND** the entry is distinct from any transcription entry for the same job

#### Scenario: Local stage does not create cloud spend
- **WHEN** a job stage runs fully on a local provider
- **THEN** the system does not append a billable cloud usage ledger entry for that stage
- **AND** the local stage does not consume cloud quota

### Requirement: Per-user daily cloud quota reservation and settlement
The system SHALL enforce a per-user daily cloud quota using reservation before execution and settlement after actual usage is known.

#### Scenario: Job is accepted within remaining quota
- **WHEN** an operator submits a job whose estimated cloud reservation is less than or equal to the operator's remaining daily cloud quota
- **THEN** the system accepts the job
- **AND** the estimated cloud reservation is reserved against that operator's current daily cloud budget

#### Scenario: Job is rejected when estimate exceeds remaining quota
- **WHEN** an operator submits a job whose estimated cloud reservation would exceed the operator's remaining daily cloud quota
- **THEN** the system rejects the submission before execution starts
- **AND** the response explains that the daily cloud quota would be exceeded

#### Scenario: Settlement releases unused reservation
- **WHEN** a job finishes with actual cloud usage lower than its reserved estimate
- **THEN** the system settles the job against actual cloud usage
- **AND** the unused reservation is released back to the operator's remaining daily cloud quota

#### Scenario: Settlement consumes overage
- **WHEN** a job finishes with actual cloud usage greater than its reserved estimate
- **THEN** the system records the overage during settlement
- **AND** later submissions from that operator are evaluated against the newly reduced remaining daily cloud quota

### Requirement: Admin-managed cloud quotas
The system SHALL let authorized administrators manage the default daily cloud quota and optional per-user overrides.

#### Scenario: Admin updates the default daily quota
- **WHEN** an authorized administrator updates the default daily cloud quota
- **THEN** the system persists the new default quota for later submissions
- **AND** existing jobs keep the reservation already stored on them

#### Scenario: Admin sets a per-user override
- **WHEN** an authorized administrator configures a specific daily cloud quota override for one operator
- **THEN** the system applies that override for later submissions from that operator
- **AND** operators without overrides continue using the default quota

### Requirement: Audit trail for governance changes
The system SHALL append an audit log entry for each admin policy or quota mutation.

#### Scenario: Admin changes a quota value
- **WHEN** an authorized administrator changes the default daily quota or a per-user override
- **THEN** the system appends an audit log entry with actor identity, timestamp, changed field, prior value, and new value

#### Scenario: Admin changes routing policy
- **WHEN** an authorized administrator changes a default provider, model, pricing version, or concurrency pool value
- **THEN** the system appends an audit log entry describing the mutation
- **AND** the audit entry is stored separately from operator job history
