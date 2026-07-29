## MODIFIED Requirements

### Requirement: Transcript punctuation remains fidelity guarded and best effort

The system SHALL preserve provider text as immutable raw evidence and SHALL
replace only the raw-derived display chunk when the completed Responses output
passes deterministic numeric, length, similarity, and repetition guards.

#### Scenario: Model makes a bounded transcript correction

- **WHEN** the completed Responses output changes punctuation, whitespace, or a
  small contextual spelling or homophone without changing numeric evidence or
  materially diverging from the source
- **THEN** the polished text replaces the raw-derived display chunk
- **AND** the provider text remains unchanged as raw evidence

#### Scenario: Model produces an unsafe rewrite

- **WHEN** the Responses output changes numeric evidence, is empty or
  repetitive, or adds, drops, reorders, translates, summarizes, or materially
  rewrites the source
- **THEN** the restorer keeps the raw-derived display chunk unchanged
- **AND** transcription continues

#### Scenario: Polishing response fails validation

- **WHEN** the request fails, times out, returns a status other than
  `completed`, or has no valid assistant output
- **THEN** the restorer keeps the raw-derived display chunk unchanged
- **AND** HTTP 400 alone may be retried once with the identical request
- **AND** every other polishing failure does not issue a hidden provider retry
- **AND** the polishing attempt still reaches a terminal usage-settlement
  outcome
