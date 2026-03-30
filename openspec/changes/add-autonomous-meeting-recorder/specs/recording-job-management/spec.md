## ADDED Requirements

### Requirement: Recording job submission
The system SHALL accept a recording job request containing a meeting link and create a persistent job record when the meeting is supported by the current access policy.

#### Scenario: Accepted supported meeting
- **WHEN** an operator submits a direct meeting link that matches a supported guest or anonymous join policy
- **THEN** the system creates a recording job
- **AND** returns a stable job identifier
- **AND** sets the initial job state to `queued`

#### Scenario: Rejected unsupported meeting
- **WHEN** an operator submits a meeting link that requires authentication, enterprise SSO, or unsupported interactive access
- **THEN** the system rejects the job
- **AND** returns a machine-readable failure reason

### Requirement: Recording job lifecycle visibility
The system SHALL expose recording job lifecycle states so operators can determine whether a meeting is queued, joining, recording, transcribing, completed, or failed.

#### Scenario: State progression
- **WHEN** a supported recording job advances through worker execution
- **THEN** the system updates the job state as work progresses
- **AND** preserves the latest state for later retrieval

#### Scenario: Failure visibility
- **WHEN** a worker cannot join or complete a meeting recording job
- **THEN** the system marks the job as `failed`
- **AND** stores a failure reason associated with the job

### Requirement: Recording result retrieval
The system SHALL allow operators to retrieve artifact metadata for completed jobs, including recording and transcript outputs when available.

#### Scenario: Completed job results
- **WHEN** an operator requests the results for a completed recording job
- **THEN** the system returns metadata for the recording artifact
- **AND** returns transcript artifact metadata if transcription has completed

#### Scenario: Incomplete job results
- **WHEN** an operator requests results for a job that has not completed
- **THEN** the system returns the current job state
- **AND** does not claim transcript completion before the transcript artifact exists
