## MODIFIED Requirements
### Requirement: Snapshot-routed transcription execution
The system SHALL generate meeting and uploaded-media transcripts using the transcription provider selected from the job's submission-time AI policy snapshot.

#### Scenario: Queued job keeps its latched transcription route
- **WHEN** a job snapshot records a specific transcription provider and model at submission time
- **AND** an administrator later changes the default transcription route before the job is claimed
- **THEN** the worker uses the transcription route stored on the job snapshot
- **AND** the job is not re-bound to the newer default

#### Scenario: Cloud transcription records billable usage
- **WHEN** a job uses a cloud transcription provider from its snapshot
- **THEN** the worker submits transcription to that cloud provider
- **AND** the control-plane records actual transcription cloud usage and cost for that job

#### Scenario: Transcription provider failure does not trigger silent fallback
- **WHEN** the transcription provider selected by the job snapshot cannot process the job
- **THEN** the system marks the transcription attempt as failed or retryable according to existing retry rules
- **AND** the system does not silently switch the job to a different provider

### Requirement: Provider-specific transcription concurrency pools
The system SHALL enforce provider-specific transcription concurrency pools.

#### Scenario: Cloud and local transcription use separate pools
- **WHEN** one or more cloud transcription jobs are already consuming the configured cloud transcription pool
- **AND** the local transcription pool still has capacity
- **THEN** a local transcription job may still be claimed and processed
- **AND** the cloud transcription pool limit does not block unrelated local transcription work

#### Scenario: Cloud transcription pool blocks additional cloud jobs
- **WHEN** the configured cloud transcription pool is full
- **THEN** later cloud-routed transcription jobs remain queued
- **AND** the system does not over-claim additional cloud transcription work until capacity becomes available
