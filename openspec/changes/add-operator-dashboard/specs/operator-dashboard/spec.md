## ADDED Requirements
### Requirement: Anonymous operator dashboard
The system SHALL provide a web dashboard that lets anonymous operators submit and track meeting and uploaded-audio jobs without username/password authentication.

#### Scenario: Operator loads dashboard for the first time
- **WHEN** a browser opens the dashboard with no existing operator identity
- **THEN** the client creates and persists an anonymous operator identifier locally
- **AND** subsequent API calls use that identifier to scope job visibility and queue rules

### Requirement: Per-operator active job limit
The system SHALL allow each operator to have at most one actively processing job at a time while permitting additional queued jobs.

#### Scenario: Operator submits multiple jobs
- **WHEN** an operator already has one job in `joining`, `recording`, or `transcribing`
- **THEN** newly submitted jobs for that operator are accepted in `queued`
- **AND** worker claim logic SHALL not start another queued job for that operator until the active one becomes terminal

### Requirement: Configurable meeting join name
The system SHALL let operators specify the meeting join name used by the note taker bot, defaulting to `Solomon - NoteTaker`.

#### Scenario: Operator submits a meeting-link job without a custom name
- **WHEN** the operator omits a join name
- **THEN** the created job stores `Solomon - NoteTaker` as the requested join name

#### Scenario: Operator submits a meeting-link job with a custom name
- **WHEN** the operator provides a custom join name
- **THEN** the created job stores and uses that requested join name for the meeting bot

### Requirement: Uploaded audio job submission
The system SHALL accept uploaded audio files as queued jobs that enter the transcription and summary pipeline without a meeting join.

#### Scenario: Operator uploads an audio file
- **WHEN** the operator uploads a supported audio file through the dashboard
- **THEN** the system stores the file as a recording artifact
- **AND** creates a queued `uploaded-audio` job scoped to that operator
- **AND** the job later transitions into transcription processing through the existing worker pipeline
