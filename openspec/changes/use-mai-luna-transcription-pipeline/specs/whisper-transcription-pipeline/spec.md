## MODIFIED Requirements

### Requirement: Configurable transcription provider

The system SHALL generate meeting and uploaded-media transcripts using the
latched configured provider selected from self-hosted Whisper, self-hosted
Qwen3-ASR 1.7B, Azure OpenAI transcription, and Azure Speech MAI-Transcribe
1.5 implementations.

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
- **AND** a Qwen or MAI attempt never silently substitutes another provider's
  transcript text

#### Scenario: Provider becomes unavailable

- **WHEN** the selected transcription provider cannot process the job because
  its runtime or remote dependency is unavailable
- **THEN** the system marks the transcription attempt as failed or retryable
  according to existing retry rules
- **AND** the system does not silently switch to a different provider

#### Scenario: MAI is selected

- **WHEN** the global provider is `azure-speech-mai-transcribe-1.5` and a
  worker claims a transcribing job
- **THEN** the worker submits prepared audio to the configured Azure Speech
  endpoint in chunks no longer than 30 seconds
- **AND** processes no more than three independent MAI chunks concurrently
- **AND** restores results to timestamp order
- **AND** each request uses `mai-transcribe-1.5` with
  `transcribeStyle=verbatim`
- **AND** each request omits `phraseList`, forced locales, and comparison text
- **AND** MAI is treated as cloud work for scheduling and quota policy

#### Scenario: MAI returns a transient HTTP 400

- **WHEN** an MAI request returns HTTP 400
- **THEN** the worker retries the identical request once
- **AND** a repeated failure terminates the transcription attempt visibly

#### Scenario: MAI has a transient transport failure

- **WHEN** an MAI request fails because of DNS, timeout, reset, or broken
  connection
- **THEN** the worker retries the identical request after 2, 10, and 30 seconds
- **AND** failure after the third retry terminates the transcription attempt
  visibly
- **AND** queued concurrent chunks that have not started are cancelled

#### Scenario: MAI returns repetitive HTTP-200 text

- **WHEN** MAI returns HTTP 200 with text rejected by the content-quality gate
- **THEN** the worker retries within the existing bounded quality policy
- **AND** it does not add answer hints or silently substitute another
  provider's text

### Requirement: Provider latching for transcription attempts

The system SHALL record the effective transcription provider and model used
when a transcription worker claims a job.

#### Scenario: Admin changes provider while work exists

- **WHEN** the administrator changes the global provider
- **THEN** later eligible claims use the newly selected provider and its model
- **AND** already claimed or completed jobs retain their original provider and
  model

#### Scenario: Latched MAI model differs from worker configuration

- **WHEN** a claimed MAI job names a model different from the worker's
  configured MAI model
- **THEN** the worker fails visibly before submitting audio
- **AND** it never labels one model as usage from another
