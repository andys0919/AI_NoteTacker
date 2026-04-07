## MODIFIED Requirements
### Requirement: Authenticated operator dashboard
The system SHALL provide a web dashboard that lets authenticated operators submit and track meeting and uploaded-media jobs under their own verified identity.

#### Scenario: Signed-in operator loads dashboard
- **WHEN** a signed-in operator opens the dashboard
- **THEN** the client uses the authenticated user session instead of a browser-local anonymous identifier
- **AND** the dashboard shows only jobs and archives owned by that authenticated user

#### Scenario: Unauthenticated visitor opens dashboard
- **WHEN** a visitor opens the dashboard without a valid authenticated session
- **THEN** the dashboard prompts for email sign-in before exposing job submission or archive data

### Requirement: Authenticated archive browsing
The dashboard SHALL let an authenticated operator revisit their own completed and failed jobs with durable transcript and summary outputs.

#### Scenario: Operator opens archived job details
- **WHEN** an authenticated operator selects one of their archived jobs
- **THEN** the dashboard shows the persisted transcript, summary, and job history for that job
- **AND** the dashboard does not require the original browser session that created the job

### Requirement: Authenticated archive search
The dashboard SHALL let an authenticated operator search their own jobs and archives by relevant content and metadata.

#### Scenario: Operator searches archived jobs
- **WHEN** an authenticated operator enters a search term that matches their uploaded file name, meeting link, transcript text, or summary text
- **THEN** the dashboard narrows the visible job list to matching jobs owned by that operator
- **AND** jobs owned by other operators are never disclosed by the search

### Requirement: Archive export actions
The dashboard SHALL let an operator export owned archive content in reusable formats.

#### Scenario: Operator exports a completed job
- **WHEN** an operator selects an export action for one of their own completed jobs with transcript data
- **THEN** the dashboard downloads the requested export format
- **AND** the export action does not disclose jobs owned by other operators

### Requirement: Interrupt uploaded-media processing
The dashboard SHALL let an operator interrupt their own queued or transcribing uploaded-media job.

#### Scenario: Operator interrupts an uploaded-media job
- **WHEN** an operator interrupts one of their own uploaded-media jobs while it is `queued` or `transcribing`
- **THEN** the job transitions to a terminal interrupted/failed state with an explicit operator-requested reason
- **AND** later worker callbacks do not overwrite that interrupted outcome
