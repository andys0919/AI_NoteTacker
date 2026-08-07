## ADDED Requirements

### Requirement: Local Codex has an explicit-quota-only Azure fallback

The system SHALL claim new summary jobs through `local-codex` and SHALL use
Azure OpenAI only when Codex's structured account state explicitly classifies a
rate or usage limit as reached. It SHALL atomically reserve at most one Azure
summary request per job before contacting Azure.

#### Scenario: Codex allowance is available

- **WHEN** the Codex rate-limit snapshot has no reached classification
- **THEN** the summary worker invokes Local Codex with the latched model and configured reasoning effort
- **AND** no Azure summary request is attempted

#### Scenario: Codex allowance is already exhausted

- **WHEN** the preflight Codex rate-limit snapshot has a non-null `rateLimitReachedType`
- **THEN** the worker invokes the configured Azure Luna summary once
- **AND** does not start a doomed local summary turn first

#### Scenario: Azure fallback returns HTTP 400

- **WHEN** the one reserved Azure fallback request returns HTTP 400
- **THEN** the worker records that request as failed and unpriced when usage cannot be recovered
- **AND** it does not replay the provider request

#### Scenario: Local Codex fails for another reason

- **WHEN** Local Codex times out or fails because of authentication, networking, configuration, schema, or another non-quota reason
- **THEN** the job records the normal summary failure
- **AND** no Azure summary request is attempted

#### Scenario: Quota status cannot be proven

- **WHEN** the structured quota probe times out, errors, or returns a malformed response
- **THEN** the worker does not classify Codex as exhausted
- **AND** does not authorize Azure fallback from error-message text

#### Scenario: A fallback job is reclaimed

- **WHEN** a worker already reserved the job's Azure fallback and the summary lease is later reclaimed
- **THEN** the replacement worker cannot reserve or invoke another Azure request

#### Scenario: Azure request audit is not authorized by the reservation

- **WHEN** an Azure request-audit start has no matching job reservation or uses a different request ID after the reservation was bound
- **THEN** the control plane rejects the start
- **AND** the worker does not contact Azure
