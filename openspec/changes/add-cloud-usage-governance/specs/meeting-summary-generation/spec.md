## MODIFIED Requirements
### Requirement: Transcript-derived meeting summaries
The system SHALL generate a derived meeting summary using the summary provider and model stored on the job's submission-time AI policy snapshot.

#### Scenario: Summary routing differs from transcription routing
- **WHEN** a job snapshot routes transcription to one provider and summary generation to a different provider
- **THEN** the system uses the stored summary provider and summary model for the summary stage
- **AND** the summary stage does not inherit the transcription route implicitly

#### Scenario: Cloud summary records billable usage
- **WHEN** a job snapshot routes summary generation to a cloud provider
- **THEN** the system records actual summary cloud usage and cost for that job
- **AND** the summary usage entry remains distinct from any transcription usage entry

#### Scenario: Later admin changes do not rewrite queued summary behavior
- **WHEN** a job snapshot stores a summary provider and summary model at submission time
- **AND** an administrator later changes the default summary route before the job reaches summary generation
- **THEN** the job keeps the summary route stored in its snapshot
- **AND** only later submissions use the newer defaults

#### Scenario: Summary provider failure does not trigger silent fallback
- **WHEN** the summary provider selected by the job snapshot cannot generate a summary
- **THEN** the system reports summary generation failure according to existing error handling
- **AND** the system does not silently switch that job to another summary provider

### Requirement: Summary-stage concurrency pools
The system SHALL enforce provider-specific summary concurrency pools.

#### Scenario: Cloud summary pool does not block local summary work
- **WHEN** the configured cloud summary pool is full
- **AND** the local summary pool still has capacity
- **THEN** a local-summary job may still continue
- **AND** the cloud summary pool limit does not block unrelated local summary work
