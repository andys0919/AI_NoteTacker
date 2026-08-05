## ADDED Requirements

### Requirement: MAI and Luna credentials are isolated by worker

The deployed transcription worker SHALL receive the configured MAI
transcription settings without Luna summary or diarization settings, and the
summary worker SHALL receive the Luna summary settings.

#### Scenario: Compose resolves the production worker environments

- **WHEN** the deployment configuration is rendered
- **THEN** the transcription-worker environment includes
  `AZURE_SPEECH_MAI_MODEL=mai-transcribe-1.5`
- **AND** excludes Luna summary credentials, transcript-polishing settings,
  and diarization settings
- **AND** the summary-worker environment includes
  `SUMMARY_MODEL=gpt-5.6-luna`
- **AND** includes `SUMMARY_REASONING_EFFORT=max`

#### Scenario: Non-AI recording worker environment is resolved

- **WHEN** canonical Compose resolves the recording-worker environment
- **THEN** it includes only recording execution, control-plane, artifact, poll,
  worker identity, and internal-service settings required by its active entrypoint
- **AND** excludes Luna, MAI, admin-console, and meeting-share credentials
