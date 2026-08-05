## ADDED Requirements

### Requirement: Raw recording-job reads stay inside the internal service boundary

The system SHALL require a dedicated non-placeholder internal service
credential of at least 32 UTF-8 bytes before returning the complete raw
recording-job DTO used by trusted workers.

#### Scenario: Unauthenticated raw job read is attempted

- **WHEN** a request reaches `GET /recording-jobs/:id` without a valid internal
  service credential
- **THEN** the system rejects the request before returning job content
- **AND** submitter, source, artifact, history, provider, and cost fields are
  not disclosed

#### Scenario: Trusted worker reads current job state

- **WHEN** a worker sends the explicitly configured internal service credential
  while reading a job
- **THEN** the route may return the worker DTO normally
- **AND** canonical deployment configuration does not substitute the documented
  `internal-token` placeholder for that credential

### Requirement: Application construction fails closed without internal authentication

The system SHALL refuse to construct or start the control-plane application
when a dedicated non-placeholder internal service credential of at least 32
UTF-8 bytes is unavailable.

#### Scenario: Exported application factory has no credential

- **WHEN** a caller invokes the exported application factory without an
  explicit credential and the environment has no configured credential
- **THEN** application construction fails with a configuration error
- **AND** internal routes are never mounted in an unauthenticated mode

#### Scenario: Canonical runtime receives the documented placeholder

- **WHEN** canonical server or Compose configuration resolves the documented
  `internal-token` placeholder
- **THEN** startup fails before the service listens for requests

#### Scenario: Internal service credential is undersized

- **WHEN** application construction or canonical startup receives an internal
  service credential shorter than 32 UTF-8 bytes
- **THEN** configuration fails before internal routes become available
