## ADDED Requirements
### Requirement: Audio and video upload ingestion
The system SHALL accept supported uploaded audio and supported uploaded video as durable media-ingestion jobs.

#### Scenario: Operator uploads an audio file
- **WHEN** an authenticated operator uploads a supported audio file
- **THEN** the system stores the raw upload artifact durably
- **AND** creates a user-owned media job that proceeds through media preparation and transcription

#### Scenario: Operator uploads a video file
- **WHEN** an authenticated operator uploads a supported video file containing an audio track
- **THEN** the system stores the raw upload artifact durably
- **AND** extracts a canonical audio derivative before transcription begins

### Requirement: Media preparation failure isolation
The system SHALL fail uploaded-media jobs with explicit preparation errors when audio extraction or normalization fails.

#### Scenario: Video-to-audio extraction fails
- **WHEN** the media-preparation worker cannot derive a valid audio artifact from the uploaded media
- **THEN** the job enters `failed`
- **AND** the operator can see a preparation-specific failure reason in the dashboard

### Requirement: Readable uploaded file names
The system SHALL preserve readable uploaded file names, including UTF-8 Chinese names, for operator-facing display and archive lookup.

#### Scenario: Existing mojibake file names are repaired
- **WHEN** the system encounters previously stored uploaded-media jobs whose file names were persisted as mojibake
- **THEN** an operator repair task can normalize those names back to readable UTF-8 text for archive display
