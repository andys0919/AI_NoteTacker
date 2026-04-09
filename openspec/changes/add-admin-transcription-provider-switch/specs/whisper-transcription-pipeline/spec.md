## MODIFIED Requirements
### Requirement: Configurable transcription provider
The system SHALL generate meeting and uploaded-media transcripts using the configured transcription provider selected from approved implementations, defaulting to self-hosted Whisper and optionally allowing Azure OpenAI `gpt-4o-mini-transcribe`.

#### Scenario: Self-hosted Whisper is selected
- **WHEN** the global transcription provider is `self-hosted-whisper` and a worker claims a transcribing job
- **THEN** the worker uses the local Whisper-based transcription engine for that claim
- **AND** the resulting transcript remains linked to the recording job as usual

#### Scenario: Azure OpenAI is selected
- **WHEN** the global transcription provider is `azure-openai-gpt-4o-mini-transcribe` and a worker claims a transcribing job
- **THEN** the worker submits the prepared audio to Azure OpenAI transcription
- **AND** the resulting transcript remains linked to the recording job as usual

#### Scenario: Provider becomes unavailable
- **WHEN** the selected transcription provider cannot process the job because its runtime or remote dependency is unavailable
- **THEN** the system marks the transcription attempt as failed or retryable according to existing retry rules
- **AND** the system does not silently switch to a different provider

### Requirement: Provider latching for transcription attempts
The system SHALL record the effective transcription provider used when a transcription worker claims a job.

#### Scenario: Admin changes provider while jobs remain queued
- **WHEN** a queued transcription job has not yet been claimed and the admin changes the global provider
- **THEN** later claims use the newly selected provider
- **AND** jobs already claimed keep the provider that was locked at claim time
