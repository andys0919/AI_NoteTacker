## MODIFIED Requirements
### Requirement: Authenticated operator dashboard
The system SHALL provide a web dashboard that lets authenticated operators submit and track meeting and uploaded-media jobs under their own verified identity while exposing workflow defaults suitable for repeated company use.

#### Scenario: Signed-in operator loads dashboard productivity settings
- **WHEN** a signed-in operator opens the authenticated dashboard
- **THEN** the dashboard shows built-in submission templates with role-oriented defaults
- **AND** the dashboard shows the operator's notification options and archive quick filters

### Requirement: Role-aware submission templates
The dashboard SHALL let an operator choose a built-in submission template that applies join-name defaults and per-job workflow preferences.

#### Scenario: Operator submits a meeting with a role template
- **WHEN** an operator chooses a built-in template and submits a meeting-link job
- **THEN** the created job stores the selected template identifier
- **AND** the job stores the template's requested summary profile and preferred export format
- **AND** the dashboard pre-fills the template's join-name default before submission

#### Scenario: Operator uploads media with a role template
- **WHEN** an operator chooses a built-in template and submits an uploaded-media job
- **THEN** the created job stores the selected template identifier
- **AND** the job stores the template's requested summary profile and preferred export format

### Requirement: Archive quick filters
The dashboard SHALL let an operator narrow their owner-scoped job list with quick filters in addition to full-text search.

#### Scenario: Operator filters archived jobs by state or recency
- **WHEN** an operator selects a quick filter such as completed, failed, active, or recent jobs
- **THEN** the dashboard narrows the visible job list to jobs owned by that operator matching the selected filter
- **AND** the full-text search term, if present, continues to apply to the filtered result set

### Requirement: Share-ready archive actions
The dashboard SHALL let an operator reuse completed job outputs without manually reconstructing them.

#### Scenario: Operator copies summary content from a completed job
- **WHEN** an operator selects a share action on a completed job with summary data
- **THEN** the dashboard can copy the full summary text or the structured key points to the clipboard
- **AND** the copied content reflects the persisted job output for that operator-owned job

#### Scenario: Operator opens a deep link to a specific job
- **WHEN** the dashboard loads with a `jobId` query parameter matching one of the operator's jobs
- **THEN** the dashboard highlights and scrolls to the matching job card after data loads
- **AND** the dashboard does not disclose jobs owned by other operators
