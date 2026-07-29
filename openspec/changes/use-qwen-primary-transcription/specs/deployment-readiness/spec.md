## ADDED Requirements

### Requirement: Qwen primary runtime is health-gated

The production deployment SHALL run the configured Qwen3-ASR service on the
local GPU and SHALL not start transcription work against it before its API is
healthy.

#### Scenario: Production stack starts with Qwen selected

- **WHEN** the production Compose stack starts with
  `qwen3-asr-1.7b` selected
- **THEN** the Qwen service loads the configured model and passes its health
  check
- **AND** the transcription worker reaches it only through the internal service
  endpoint
- **AND** local transcription concurrency remains bounded to one

#### Scenario: Qwen cannot become healthy

- **WHEN** the Qwen service cannot load within its bounded health-check window
- **THEN** the transcription worker does not begin Qwen claims against an
  unready endpoint
- **AND** operators can explicitly roll future claims back to another ready
  provider
