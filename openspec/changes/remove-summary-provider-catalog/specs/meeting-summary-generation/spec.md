## ADDED Requirements

### Requirement: Fixed summary routing uses the canonical provider contract

The control plane SHALL derive primary summary readiness, persistence defaults,
and the admin provider option directly from the canonical fixed `local-codex`
domain values without a separate provider catalog or environment factory. It
SHALL preserve historical Azure attribution and the internal quota-fallback
contract.

#### Scenario: Operator reads the AI policy

- **WHEN** an authenticated operator reads the current AI policy
- **THEN** `summaryProvider` remains `local-codex`
- **AND** `summaryOptions` contains the same single ready Local Codex option

#### Scenario: Operator saves the fixed summary route

- **WHEN** an authenticated operator saves a valid AI policy with `summaryProvider=local-codex`
- **THEN** the control plane persists and returns the same provider value
- **AND** no configurable catalog is required to authorize the fixed route

#### Scenario: A job snapshots summary readiness

- **WHEN** the current policy uses the canonical `local-codex` provider
- **THEN** a new eligible job requests its summary exactly as before
- **AND** historical Azure records and quota-fallback accounting remain unchanged
