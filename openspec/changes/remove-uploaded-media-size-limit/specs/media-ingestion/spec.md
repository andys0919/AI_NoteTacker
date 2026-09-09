## MODIFIED Requirements

### Requirement: Streamed uploaded-media ingestion

The system SHALL ingest uploaded media without requiring the control-plane
application to keep the full file resident in process memory and SHALL NOT
reject supported media solely because of an application-level byte limit.

#### Scenario: Large uploaded media is ingested with bounded memory

- **WHEN** an operator uploads a large supported audio or video file that the
  configured ingress, filesystem, and durable storage can accept
- **THEN** the system streams or delegates the upload into durable storage
- **AND** the control-plane does not require the entire file body to remain in
  memory at once
- **AND** no control-plane byte limit rejects the file

#### Scenario: Concurrent uploads remain bounded

- **WHEN** multiple operators upload supported media concurrently
- **THEN** each upload can proceed with bounded control-plane memory growth
- **AND** earlier large uploads do not force later uploads to fail solely
  because full-file buffering exhausted heap memory

#### Scenario: Supported media is not capped by the control plane

- **WHEN** an operator uploads supported audio or video larger than the former
  512 MiB threshold
- **THEN** the control plane accepts it for durable storage subject only to
  existing authentication, validation, queue, storage, and infrastructure
  capacity checks
- **AND** it does not return `uploaded-media-too-large` solely for the file's
  byte size
