## ADDED Requirements

### Requirement: Luna max is used only for meeting summary generation

The system SHALL use `gpt-5.6-luna` with `reasoning.effort=max` only in the
summary worker after the display transcript has been stored.

#### Scenario: Summary follows MAI transcription

- **WHEN** a summary-enabled MAI job has stored its raw and display transcript
- **THEN** the summary worker sends the display transcript to a new
  `gpt-5.6-luna` request with `reasoning.effort=max`
- **AND** the transcription worker does not receive or use Luna summary
  credentials
- **AND** the request produces the meeting summary rather than rewriting the
  transcript
