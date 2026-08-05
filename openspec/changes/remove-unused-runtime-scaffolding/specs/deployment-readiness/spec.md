## ADDED Requirements

### Requirement: Runtime topology contains only active dependencies
The deployment topology SHALL provision only services and resources consumed by active runtime code.

#### Scenario: Maintainer renders the canonical Compose stack
- **WHEN** the production or smoke Compose configuration is rendered
- **THEN** it does not include an application dependency with no runtime client or consumer
- **AND** control-plane startup does not wait for such a service

#### Scenario: Independently scheduled workers start
- **WHEN** the transcription and summary worker services start
- **THEN** each service receives only stage-relevant explicit settings and host resource reservations
- **AND** the summary worker does not require Whisper configuration or a GPU reservation
- **AND** the transcription worker does not mount local Codex state
