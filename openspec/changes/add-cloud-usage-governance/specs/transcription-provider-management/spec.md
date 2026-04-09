## MODIFIED Requirements
### Requirement: Admin-managed transcription provider selection
The system SHALL let an authorized administrator view and update the default AI routing policy used for future jobs, including transcription provider/model, summary provider/model, pricing version, and stage-specific concurrency pool settings.

#### Scenario: Admin views the current AI routing policy
- **WHEN** an authorized administrator opens the AI routing settings surface
- **THEN** the system returns the current defaults for transcription and summary routing
- **AND** the system returns supported provider and model options with non-secret readiness metadata
- **AND** the system returns the current pricing version and stage-specific concurrency pool values

#### Scenario: Admin updates summary routing independently
- **WHEN** an authorized administrator changes the default summary provider or summary model while leaving transcription defaults unchanged
- **THEN** the system persists only the requested summary routing change for future jobs
- **AND** future transcription routing remains unchanged until separately updated

#### Scenario: Admin updates transcription routing independently
- **WHEN** an authorized administrator changes the default transcription provider or transcription model while leaving summary defaults unchanged
- **THEN** the system persists only the requested transcription routing change for future jobs
- **AND** future summary routing remains unchanged until separately updated

### Requirement: Admin-only provider management
The system SHALL restrict AI routing and cloud governance settings management to authenticated administrators.

#### Scenario: Non-admin requests AI routing settings
- **WHEN** an authenticated operator who is not an administrator requests the AI routing or governance settings API
- **THEN** the system rejects the request
- **AND** the operator does not learn protected management details beyond ordinary dashboard behavior

### Requirement: Provider readiness validation
The system SHALL refuse to switch a default route to a provider whose required server-side configuration is not ready.

#### Scenario: Admin selects an unready cloud summary provider
- **WHEN** an administrator requests a cloud summary provider whose required server-side configuration is incomplete
- **THEN** the system rejects the change with a clear readiness error
- **AND** the previously active summary routing remains unchanged

#### Scenario: Admin selects an unready cloud transcription provider
- **WHEN** an administrator requests a cloud transcription provider whose required server-side configuration is incomplete
- **THEN** the system rejects the change with a clear readiness error
- **AND** the previously active transcription routing remains unchanged

### Requirement: Server-side secret isolation
The system SHALL keep provider secrets out of browser-visible routing and governance payloads.

#### Scenario: Admin loads the routing policy
- **WHEN** an administrator fetches the current routing or governance settings from the dashboard
- **THEN** the response includes only non-secret policy values and readiness metadata
- **AND** provider credentials, endpoint secrets, and API keys are never returned to the browser
