## ADDED Requirements

### Requirement: Local Codex is the only selectable primary summary route

The system SHALL route every newly submitted summary-enabled job through
`local-codex`, using the configured Codex model and reasoning effort, and SHALL
not expose Azure OpenAI as a selectable or claimable primary provider. The
internal quota-only fallback is governed by `add-azure-summary-quota-fallback`.

#### Scenario: A new job becomes ready for summary generation

- **WHEN** a newly submitted job stores its transcript artifact
- **THEN** the summary worker claims it as `local-codex`
- **AND** invokes Codex CLI with the job's latched model and configured reasoning effort
- **AND** no Azure Responses summary request is attempted while Codex has allowance

#### Scenario: A persisted policy references the retired route

- **WHEN** the current singleton policy still contains `azure-openai` as its summary provider
- **THEN** the control plane normalizes and persists the provider as `local-codex`
- **AND** completed historical job and usage records remain unchanged

#### Scenario: An operator views the summary routing policy

- **WHEN** the operator opens the governance settings
- **THEN** the interface identifies Local Codex as the fixed primary summary route
- **AND** it does not present a summary-provider selector with no meaningful alternative
