## MODIFIED Requirements

### Requirement: Transcript punctuation is an independent cloud usage stage

The system SHALL account for cloud transcript polishing under the existing
stage name `punctuation`, independently from `transcription` and `summary`, and
SHALL distinguish provider request attempts from accepted or fallback logical
chunks.

#### Scenario: Polishing succeeds after cloud transcription

- **WHEN** a cloud polishing attempt returns provider usage
- **THEN** the ledger records that usage under `stage=punctuation`
- **AND** the usage is not merged into transcription or summary usage

#### Scenario: Best-effort polishing falls back to raw-derived text

- **WHEN** one or more polishing calls fail validation and the transcript keeps
  raw-derived display chunks
- **THEN** the punctuation entry preserves the metered token subtotal from
  successful provider responses
- **AND** it records request, accepted, fallback, and unmetered-request counts
- **AND** the best-effort fallback does not hide provider usage already incurred

#### Scenario: Polishing retry later succeeds

- **WHEN** one logical chunk succeeds after an earlier unmetered provider
  request
- **THEN** `requestCount` includes both provider attempts
- **AND** `acceptedChunkCount` plus `fallbackChunkCount` records the one logical
  chunk outcome
- **AND** `unmeteredRequestCount` may exceed `fallbackChunkCount` but never
  `requestCount`
