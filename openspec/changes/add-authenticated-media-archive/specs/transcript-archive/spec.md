## ADDED Requirements
### Requirement: Durable transcript and summary archive
The system SHALL preserve transcript and summary outputs as durable user-owned archive records.

#### Scenario: Completed job is revisited later
- **WHEN** an authenticated operator opens a previously completed job from the archive
- **THEN** the system returns the persisted transcript text, summary text, and artifact metadata for that job

#### Scenario: Archive ownership is enforced
- **WHEN** one authenticated operator attempts to access another operator's archived job
- **THEN** the system denies access
- **AND** no transcript or summary data is disclosed

### Requirement: Searchable archive retrieval
The system SHALL support query-based retrieval of a user's own archived jobs.

#### Scenario: Query matches transcript or summary content
- **WHEN** an authenticated operator searches with a term present in their persisted transcript or summary text
- **THEN** the archive response includes the matching owned jobs
- **AND** unrelated owned jobs may be omitted from the filtered result

### Requirement: Exportable archive formats
The system SHALL support exporting owned archive content in multiple reusable formats.

#### Scenario: Completed archive exports as Markdown
- **WHEN** an operator exports one of their own completed jobs as Markdown
- **THEN** the exported file includes job metadata, summary text when present, and transcript content in Markdown form

#### Scenario: Completed archive exports as SRT
- **WHEN** an operator exports one of their own completed jobs as SRT
- **THEN** the exported file uses transcript segment timestamps and text in valid subtitle ordering

#### Scenario: Archive ownership is enforced for export
- **WHEN** one operator attempts to export another operator's job
- **THEN** the system denies the export
- **AND** no transcript or summary content is disclosed
