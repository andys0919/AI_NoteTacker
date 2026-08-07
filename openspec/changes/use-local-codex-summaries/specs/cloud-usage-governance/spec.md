## ADDED Requirements

### Requirement: Subscription summaries are not reported as Azure spend

The system SHALL treat `local-codex` summaries as non-cloud work and SHALL not
write an Azure/API actual-cost entry or describe subscription access as a
zero-dollar provider charge.

#### Scenario: A local Codex summary completes

- **WHEN** a `local-codex` summary artifact is stored
- **THEN** cloud usage settlement does not append an actual summary cost row
- **AND** any displayed billing language distinguishes subscription access from metered API spend

#### Scenario: An operator reviews Azure summary usage

- **WHEN** the ledger contains a historical or quota-fallback Azure summary entry
- **THEN** the system preserves and resolves that historical entry with its recorded provider and pricing provenance
- **AND** the entry is not relabeled as local Codex usage

#### Scenario: Local Codex output fails summary validation

- **WHEN** the Codex process exits successfully but its summary output is empty or schema-invalid
- **THEN** the subscription request audit is finalized as failed with any trustworthy token usage
- **AND** no summary artifact or Azure/API actual-cost row is written
