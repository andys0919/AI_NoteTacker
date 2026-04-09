## ADDED Requirements
### Requirement: Admin-managed transcription provider selection
The system SHALL let an authorized administrator view and update the global transcription provider used for future transcription claims.

#### Scenario: Admin views current provider
- **WHEN** an authorized administrator opens the transcription provider settings surface
- **THEN** the system returns the currently selected global provider
- **AND** the system returns the supported provider options with non-secret readiness metadata

#### Scenario: Admin updates current provider
- **WHEN** an authorized administrator selects a different supported provider
- **THEN** the system persists that provider as the new global default for future transcription claims
- **AND** the response confirms the new effective provider without disclosing provider secrets

### Requirement: Admin-only provider management
The system SHALL restrict transcription provider management to authenticated administrators.

#### Scenario: Non-admin requests provider settings
- **WHEN** an authenticated operator who is not an administrator requests the transcription provider settings API
- **THEN** the system rejects the request
- **AND** the operator does not learn protected provider-management details beyond ordinary dashboard behavior

### Requirement: Provider readiness validation
The system SHALL refuse to switch to a provider whose required server-side configuration is not ready.

#### Scenario: Admin selects Azure without complete server configuration
- **WHEN** an administrator requests `azure-openai-gpt-4o-mini-transcribe` but the required Azure env values are not all configured
- **THEN** the system rejects the change with a clear readiness error
- **AND** the previously active provider remains unchanged

### Requirement: Server-side secret isolation
The system SHALL keep transcription provider secrets out of browser-visible settings payloads.

#### Scenario: Admin loads provider settings
- **WHEN** an administrator fetches the current provider settings from the dashboard
- **THEN** the response includes only provider identity and readiness metadata
- **AND** Azure endpoint secrets, deployment secrets, and API keys are never returned to the browser
