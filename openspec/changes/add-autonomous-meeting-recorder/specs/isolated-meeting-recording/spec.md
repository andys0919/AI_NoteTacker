## ADDED Requirements

### Requirement: Isolated worker-based recording
The system SHALL execute meeting joins and media capture inside dedicated workers that are independent from the submitting user's workstation audio environment.

#### Scenario: Worker-local media capture
- **WHEN** a recording job is assigned to a worker
- **THEN** the worker launches its own browser session and media capture stack
- **AND** records worker-local meeting media instead of the submitter's system audio

#### Scenario: Submitter workstation independence
- **WHEN** a recording job is running
- **THEN** the system does not require the submitter's workstation to stay connected, idle, or reserved for audio capture

### Requirement: Direct-link guest join policy
The system SHALL join meetings only through direct meeting links that permit guest or anonymous participation without storing user platform credentials.

#### Scenario: Guest join supported meeting
- **WHEN** a meeting platform allows guest or anonymous join through the provided meeting link
- **THEN** the worker attempts to join using the configured bot identity
- **AND** does not request stored personal Google, Microsoft, or Zoom credentials

#### Scenario: Credential-gated meeting
- **WHEN** the meeting flow requires platform login or credential-backed authorization before entry
- **THEN** the worker stops the join attempt
- **AND** marks the job as unsupported or failed with a clear reason

### Requirement: Recording artifact persistence
The system SHALL persist the original recording artifact produced by a successful meeting capture.

#### Scenario: Successful recording upload
- **WHEN** a worker completes a meeting recording successfully
- **THEN** the system stores the recording artifact in configured object storage
- **AND** links the stored artifact to the originating recording job

#### Scenario: Upload failure after recording
- **WHEN** recording capture succeeds but artifact persistence fails
- **THEN** the system marks the job as failed
- **AND** preserves diagnostic information indicating that capture succeeded but storage did not
