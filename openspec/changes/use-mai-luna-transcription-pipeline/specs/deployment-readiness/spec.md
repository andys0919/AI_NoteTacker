## ADDED Requirements

### Requirement: MAI and Luna runtime configuration is health-gated

The production deployment SHALL expose MAI as ready only when its endpoint,
key, and model are configured, and SHALL configure Luna polishing and summary
with explicit max effort.

#### Scenario: Production starts with MAI selected

- **WHEN** the production stack starts with
  `azure-speech-mai-transcribe-1.5` selected
- **THEN** the control plane reports MAI ready without exposing its key
- **AND** the transcription worker can complete an authenticated MAI request
- **AND** both Luna stages send `reasoning.effort=max`

#### Scenario: MAI credentials are absent

- **WHEN** the MAI endpoint, key, or model is missing
- **THEN** MAI is reported not ready
- **AND** future policy cannot switch to MAI until configuration is complete
