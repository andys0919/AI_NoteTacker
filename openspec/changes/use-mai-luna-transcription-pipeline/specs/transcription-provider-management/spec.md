## MODIFIED Requirements

### Requirement: Admin-managed transcription provider selection

The system SHALL let an authorized administrator view and update the global
transcription provider used for future transcription claims, including
self-hosted Qwen3-ASR 1.7B and Azure Speech MAI-Transcribe 1.5.

#### Scenario: Admin views configured Qwen

- **WHEN** Qwen endpoint and served-model values are configured
- **THEN** provider settings expose `qwen3-asr-1.7b` as ready
- **AND** the response contains no provider secrets

#### Scenario: Admin switches to Qwen

- **WHEN** an authorized administrator selects `qwen3-asr-1.7b`
- **THEN** the system persists Qwen and its configured model as the global
  default for future claims
- **AND** existing claimed or completed jobs remain unchanged

#### Scenario: Admin views configured MAI

- **WHEN** the MAI endpoint, API key, and model are configured
- **THEN** provider settings expose `azure-speech-mai-transcribe-1.5` as ready
- **AND** the response contains no provider secret

#### Scenario: Admin switches to MAI

- **WHEN** an authorized administrator selects
  `azure-speech-mai-transcribe-1.5`
- **THEN** the system persists MAI and `mai-transcribe-1.5` as the global
  default for future claims
- **AND** existing claimed or completed jobs remain unchanged

### Requirement: Provider readiness validation

The system SHALL refuse to switch to a provider whose required server-side
configuration is incomplete.

#### Scenario: Qwen configuration is incomplete

- **WHEN** an administrator requests `qwen3-asr-1.7b` without both a Qwen
  endpoint and served-model value
- **THEN** the system rejects the change with a clear readiness error
- **AND** the previously active provider remains unchanged

#### Scenario: MAI configuration is incomplete

- **WHEN** an administrator requests `azure-speech-mai-transcribe-1.5` without
  its endpoint, API key, or model
- **THEN** the system rejects the change with a clear readiness error
- **AND** the previously active provider remains unchanged
