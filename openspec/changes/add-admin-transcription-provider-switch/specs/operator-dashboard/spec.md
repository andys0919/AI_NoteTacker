## ADDED Requirements
### Requirement: Admin transcription provider panel
The dashboard SHALL expose a simple transcription provider panel to authorized administrators.

#### Scenario: Admin opens dashboard
- **WHEN** an authorized administrator opens the authenticated dashboard
- **THEN** the dashboard shows the current transcription provider
- **AND** the dashboard provides controls to switch between local Whisper and Azure OpenAI transcription

#### Scenario: Admin switches provider from the dashboard
- **WHEN** an authorized administrator submits a provider change from the dashboard
- **THEN** the dashboard reflects the updated provider after the server accepts the change
- **AND** the dashboard shows a clear error if the requested provider is not ready

### Requirement: Non-admin dashboard isolation
The dashboard SHALL not expose global provider controls to ordinary operators.

#### Scenario: Non-admin opens dashboard
- **WHEN** an authenticated operator who is not an administrator opens the dashboard
- **THEN** the provider management panel is hidden
- **AND** the operator can continue using ordinary job submission and archive features
