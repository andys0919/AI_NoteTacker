## ADDED Requirements

### Requirement: Independent Luna max summary generation

The system SHALL generate the meeting summary from the stored display
transcript using a new `gpt-5.6-luna` Responses request with
`reasoning.effort=max`.

#### Scenario: Summary follows transcript polishing

- **WHEN** a summary-enabled MAI job has stored its raw and display transcript
- **THEN** the summary worker sends the display transcript to a separate Luna
  max request
- **AND** the request does not reuse a polishing response ID or reasoning state
- **AND** the summary artifact records `gpt-5.6-luna` and `max`

#### Scenario: Generated summary is benchmarked

- **WHEN** the correct HDD meeting has a completed generated summary
- **THEN** the benchmark compares it with the PLAUD summary after generation
- **AND** reports concrete agreements and disagreements without treating PLAUD
  as authoritative ground truth
