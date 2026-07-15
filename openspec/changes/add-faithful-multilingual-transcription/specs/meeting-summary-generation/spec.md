## MODIFIED Requirements

### Requirement: Explicit summary-stage outcomes
The system SHALL expose summary stage outcomes explicitly instead of reducing summary failures to hidden worker-side logs, and a successful summary SHALL remain constrained to facts explicitly supported by the transcript.

#### Scenario: Summary generation succeeds after transcript completion
- **WHEN** a summary-enabled job completes summary generation successfully
- **THEN** the job stores the summary artifact
- **AND** the operator can see that summary generation finished successfully
- **AND** structured sections contain only transcript-supported facts, actions, decisions, risks, and open questions

#### Scenario: Transcript has no explicit item for a structured section
- **WHEN** the transcript does not explicitly state an action, decision, risk, or open question
- **THEN** the corresponding summary array is empty
- **AND** the summary does not create a generic item merely because it would be reasonable

#### Scenario: Transcript contains an unresolved review flag
- **WHEN** a transcript phrase has an unresolved correction candidate or uncertain language representation
- **THEN** the summary does not promote the candidate to a confirmed fact
- **AND** names, numbers, dates, units, and model identifiers remain faithful to accepted transcript evidence

#### Scenario: Summary generation fails after transcript completion
- **WHEN** a summary-enabled job encounters a summary-stage failure
- **THEN** the job records an explicit summary-stage failure outcome visible to the operator
- **AND** the failure is not reduced to console-only logging
