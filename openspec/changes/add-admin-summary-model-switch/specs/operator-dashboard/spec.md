## ADDED Requirements
### Requirement: Admin summary model input
The dashboard SHALL expose an admin-only input for the current summary model used by future summary generation.

#### Scenario: Admin opens dashboard
- **WHEN** an authorized administrator opens the authenticated dashboard
- **THEN** the dashboard shows the current summary model value
- **AND** the dashboard provides an input that accepts a free-form model name for future summaries

#### Scenario: Admin updates the summary model
- **WHEN** an authorized administrator submits a new summary model value
- **THEN** the dashboard reflects the updated value after the server accepts the change
- **AND** the change applies only to future summary jobs

#### Scenario: Non-admin operator cannot access summary model controls
- **WHEN** a non-admin operator requests the summary model settings API or opens the dashboard
- **THEN** the API rejects the request
- **AND** the dashboard does not expose the admin-only summary model controls
