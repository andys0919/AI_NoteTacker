## ADDED Requirements

### Requirement: MAI transcript display uses deterministic language normalization

The system SHALL preserve MAI provider text as raw evidence, SHALL normalize
Chinese display text to Traditional Chinese deterministically, and SHALL NOT
send transcript text to a language model for polishing or speaker
diarization.

#### Scenario: MAI returns a Chinese locale

- **WHEN** MAI returns transcript text with a Chinese locale such as `zh`,
  `zh-CN`, or `zh-TW`
- **THEN** the worker stores the provider text unchanged as `rawText`
- **AND** normalizes the segment language to `zh-Hant`
- **AND** converts only `displayText` to Traditional Chinese
- **AND** issues no transcript-polishing request
- **AND** issues no diarization request

#### Scenario: MAI returns a non-Chinese locale

- **WHEN** MAI returns transcript text with a non-Chinese locale
- **THEN** the worker preserves that language
- **AND** does not translate the display text
- **AND** issues no transcript-polishing or diarization request
