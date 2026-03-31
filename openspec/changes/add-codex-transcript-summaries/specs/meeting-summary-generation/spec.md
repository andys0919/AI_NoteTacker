## ADDED Requirements
### Requirement: Transcript-derived meeting summaries
The system SHALL generate a derived meeting summary from a completed transcript using the configured Codex summarization backend.

#### Scenario: Summary generated after transcript completion
- **WHEN** a recording job has a completed transcript artifact and summary generation succeeds
- **THEN** the system stores a summary artifact on the job
- **AND** the summary artifact includes the summary text and the summarization model metadata

#### Scenario: Summary visible in job retrieval
- **WHEN** an operator requests a completed job that has a generated summary
- **THEN** the API returns the summary artifact alongside recording and transcript artifacts
