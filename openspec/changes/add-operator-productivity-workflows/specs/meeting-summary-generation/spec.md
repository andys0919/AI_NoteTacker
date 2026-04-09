## MODIFIED Requirements
### Requirement: Transcript-derived meeting summaries
The system SHALL generate a derived meeting summary from a completed transcript using the configured Codex summarization backend and any persisted summary profile requested by the job.

#### Scenario: Job requests a summary profile
- **WHEN** a recording job stores a requested summary profile such as general, sales, product, or HR
- **AND** summary generation runs for that job
- **THEN** the summarization prompt applies the requested profile as an emphasis for the generated summary
- **AND** the resulting summary remains faithful to the transcript

#### Scenario: Job does not request a summary profile
- **WHEN** a recording job has no requested summary profile
- **THEN** the system falls back to the default generic summary framing
- **AND** summary generation continues without requiring operator intervention
