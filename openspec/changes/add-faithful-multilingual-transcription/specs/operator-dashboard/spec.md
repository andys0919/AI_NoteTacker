## MODIFIED Requirements

### Requirement: On-demand heavy archive detail retrieval
The system SHALL return full transcript and summary bodies, including available raw transcript evidence and review flags, only through explicit per-job detail or export retrieval paths.

#### Scenario: Operator opens one archived job
- **WHEN** the operator requests the details for one owned job
- **THEN** the system returns the heavy transcript and summary data for that job
- **AND** the list polling path remains lightweight for other jobs

#### Scenario: Detailed transcript contains review evidence
- **WHEN** a new transcript segment has raw text, derived display text, language evidence, or review flags
- **THEN** the owned job detail response preserves those fields
- **AND** the default view shows display text
- **AND** the operator can inspect raw text and uncertainty candidates without either being presented as an accepted correction

#### Scenario: Transcript JSON is exported
- **WHEN** the operator exports a new transcript artifact as JSON
- **THEN** the export retains raw text, display text, language evidence, timing provenance, and review flags that were stored
- **AND** legacy artifacts remain exportable without fabricated evidence fields
