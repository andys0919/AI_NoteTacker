## ADDED Requirements
### Requirement: Submission-time AI policy snapshot
The system SHALL snapshot the effective AI processing policy onto each job when the operator submits it.

#### Scenario: Admin changes defaults after a job is submitted
- **WHEN** an operator submits a job
- **AND** the system stores the effective transcription provider, transcription model, summary provider, summary model, and pricing version on that job
- **AND** an administrator later changes one or more default AI settings before the worker claims the job
- **THEN** the queued job keeps the snapshot captured at submission time
- **AND** only jobs submitted after the admin change use the newer defaults

#### Scenario: Snapshot covers mixed local and cloud routing
- **WHEN** the effective default policy routes transcription and summary to different providers
- **THEN** the stored job snapshot records each stage independently
- **AND** later execution uses the recorded routing combination without inferring it again from global defaults

### Requirement: Submission-time quota reservation metadata
The system SHALL store quota reservation metadata on each job when cloud quota enforcement applies.

#### Scenario: Job stores reservation details
- **WHEN** a newly submitted job requires any cloud-routed stage
- **THEN** the job stores the estimated cloud reservation, reserved quota amount, and quota day key used for enforcement
- **AND** later settlement can reconcile actual cloud cost against the stored reservation context

#### Scenario: Pricing changes do not rewrite an existing job
- **WHEN** an operator submits a job under pricing version `v1`
- **AND** an administrator later updates the pricing catalog to version `v2`
- **THEN** the submitted job keeps pricing version `v1` in its snapshot
- **AND** only later jobs use pricing version `v2`
