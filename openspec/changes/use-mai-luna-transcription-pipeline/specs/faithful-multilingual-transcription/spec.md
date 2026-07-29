## ADDED Requirements

### Requirement: Evidence-preserving Luna transcript polishing

The system SHALL preserve MAI provider text as immutable raw evidence and use
an independent `gpt-5.6-luna` Responses request with
`reasoning.effort=max` to produce guarded display text.

#### Scenario: Luna safely polishes an MAI chunk

- **WHEN** MAI returns non-empty transcript text
- **THEN** the worker stores that provider text as `rawText`
- **AND** sends only the raw-derived chunk and generic fidelity instructions to
  a new Luna max request
- **AND** stores accepted spelling, homophone, punctuation, and sentence
  corrections as `displayText`
- **AND** records lexical correction evidence for operator review

#### Scenario: Luna polishing is unsafe or unavailable

- **WHEN** the Luna call fails or its output is empty, repetitive,
  number-changing, translating, summarizing, or materially divergent
- **THEN** the worker rejects that output
- **AND** keeps the deterministic raw-derived display text
- **AND** never alters `rawText`

#### Scenario: Luna polishing succeeds after one HTTP 400 retry

- **WHEN** the first polishing request returns HTTP 400 without trustworthy
  usage and the identical second request produces an accepted display chunk
- **THEN** usage records two provider requests, one accepted chunk, zero
  fallback chunks, and one unmetered request
- **AND** the control plane accepts provider-attempt counts that exceed logical
  chunk outcomes

#### Scenario: External comparison cannot influence generation

- **WHEN** a transcript or summary is generated for the benchmark recording
- **THEN** PLAUD text, stored Azure text, and recording-derived expected answers
  are absent from MAI and Luna generation prompts
- **AND** those sources may be used only after generation for comparison
