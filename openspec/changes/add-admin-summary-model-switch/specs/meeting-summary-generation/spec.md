## MODIFIED Requirements
### Requirement: Transcript-derived meeting summaries
The system SHALL generate transcript-derived summaries using the currently configured summary model for future jobs.

#### Scenario: Admin changes the summary model before a claim
- **WHEN** an administrator updates the current summary model
- **AND** a transcription worker later claims a job that will generate a summary
- **THEN** the claim payload includes the configured summary model
- **AND** the resulting summary artifact records that model value

#### Scenario: Existing completed summaries remain unchanged
- **WHEN** an administrator updates the current summary model
- **THEN** completed jobs keep the summary artifact already stored on them
- **AND** only future summary generation uses the new model
