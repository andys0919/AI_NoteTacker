## ADDED Requirements

### Requirement: Whisper-only transcription
The system SHALL generate meeting transcripts using a self-hosted Whisper-based transcription engine and SHALL NOT depend on third-party hosted STT providers in the MVP.

#### Scenario: Successful Whisper transcription
- **WHEN** a completed recording artifact is ready for transcription
- **THEN** the system submits the artifact to a Whisper-based transcription worker
- **AND** stores the resulting transcript as a derived artifact

#### Scenario: No fallback STT provider
- **WHEN** Whisper processing is unavailable
- **THEN** the system marks transcription as failed or pending retry
- **AND** does not silently switch to a hosted STT provider

### Requirement: Transcript linkage to recording jobs
The system SHALL associate each transcript artifact with the recording job and source recording artifact that produced it.

#### Scenario: Transcript retrieval
- **WHEN** an operator retrieves a completed recording job
- **THEN** the returned metadata includes the transcript artifact reference
- **AND** the transcript is attributable to its source recording artifact

#### Scenario: Retranscription from source artifact
- **WHEN** an operator requests retranscription of an existing recording artifact
- **THEN** the system can create a new transcription attempt using the stored recording artifact
- **AND** does not require the meeting to be rejoined

### Requirement: Timestamped transcript output
The system SHALL produce timestamped transcript segments suitable for later note generation, search, and review.

#### Scenario: Timestamped segments available
- **WHEN** Whisper transcription completes successfully
- **THEN** the transcript output contains segment timing metadata
- **AND** the transcript can be consumed without parsing raw Whisper logs
