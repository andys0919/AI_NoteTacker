## ADDED Requirements
### Requirement: Durable stage progress
The system SHALL persist stage-level progress for each job so operators can observe current processing and later review what happened.

#### Scenario: Uploaded-media job advances through stages
- **WHEN** an uploaded-media job moves from raw upload into media preparation, transcription, and summary generation
- **THEN** the system records each stage transition durably
- **AND** the operator can see the current stage and prior stage history in the dashboard

#### Scenario: Worker stops heartbeating during a stage
- **WHEN** a worker claims a job stage but stops heartbeating before completion
- **THEN** the system detects the stale lease
- **AND** the job can be retried or failed without being stuck indefinitely

#### Scenario: Stale transcription lease is reclaimed
- **WHEN** a transcription job remains claimed past the stale threshold without further heartbeat or progress updates
- **THEN** the system releases or reassigns that stale transcription lease
- **AND** a later transcription worker claim can resume the job without manual database intervention

### Requirement: GPU-aware transcription concurrency
The system SHALL gate concurrent transcription claims so uploaded-media jobs queue instead of oversubscribing shared GPU capacity.

#### Scenario: Shared GPU is at transcription capacity
- **WHEN** the configured maximum number of concurrent transcription jobs is already active
- **THEN** later transcription worker claim requests do not claim another queued uploaded-media job
- **AND** those jobs remain queued until a transcription slot becomes available
