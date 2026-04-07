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

### Requirement: Structured meeting summary sections
The system SHALL persist structured summary sections alongside the human-readable summary text.

#### Scenario: Structured sections generated from transcript
- **WHEN** summary generation succeeds
- **THEN** the summary artifact includes structured fields for action items, decisions, risks, and open questions
- **AND** the artifact still includes a readable Markdown summary text
