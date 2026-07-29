## MODIFIED Requirements

### Requirement: Configurable transcription provider

The system SHALL generate meeting and uploaded-media transcripts using the
latched configured provider selected from self-hosted Whisper, self-hosted
Qwen3-ASR 1.7B, and configured Azure OpenAI transcription implementations.

#### Scenario: Qwen is selected

- **WHEN** the global transcription provider is `qwen3-asr-1.7b` and a worker
  claims a transcribing job
- **THEN** the worker submits prepared audio to the configured local Qwen API in
  chunks no longer than 60 seconds
- **AND** the resulting transcript remains linked to the recording job as usual
- **AND** Qwen is treated as local work for scheduling and cloud-quota policy

#### Scenario: Explicit fallback provider is selected

- **WHEN** an administrator selects self-hosted Whisper or configured Azure
  OpenAI transcription
- **THEN** future claims use that selected provider
- **AND** a Qwen attempt never silently substitutes Azure or Whisper transcript
  text

#### Scenario: Provider becomes unavailable

- **WHEN** the selected transcription provider cannot process the job because
  its runtime or remote dependency is unavailable
- **THEN** the system marks the transcription attempt as failed or retryable
  according to existing retry rules
- **AND** the system does not silently switch to a different provider

### Requirement: Provider latching for transcription attempts

The system SHALL record the effective transcription provider and model used
when a transcription worker claims a job.

#### Scenario: Admin changes provider while work exists

- **WHEN** the administrator changes the global provider to or from Qwen
- **THEN** later eligible claims use the newly selected provider and its model
- **AND** already claimed or completed jobs retain their original provider and
  model
