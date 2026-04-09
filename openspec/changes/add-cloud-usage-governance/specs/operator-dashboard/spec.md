## ADDED Requirements
### Requirement: Admin cloud governance panel
The dashboard SHALL expose an admin-only governance panel for AI routing, cloud quota, concurrency, and audit history.

#### Scenario: Admin opens the governance panel
- **WHEN** an authorized administrator opens the authenticated dashboard
- **THEN** the dashboard shows the current default transcription route, summary route, pricing version, daily cloud quota, and stage-specific concurrency values
- **AND** the dashboard provides controls to update those values

#### Scenario: Admin manages per-user quota overrides
- **WHEN** an authorized administrator opens the cloud quota management surface
- **THEN** the dashboard lets the admin review and update per-user daily cloud quota overrides
- **AND** the dashboard reflects the saved override after the server accepts the change

#### Scenario: Admin reviews recent governance audit history
- **WHEN** an authorized administrator opens the governance audit view
- **THEN** the dashboard shows recent policy and quota mutations with actor, timestamp, and change summary

### Requirement: Operator cloud quota visibility
The dashboard SHALL show authenticated operators their current daily cloud budget status when cloud quota enforcement is enabled.

#### Scenario: Operator opens the dashboard with quota enforcement enabled
- **WHEN** an authenticated operator opens the dashboard
- **THEN** the dashboard shows that operator's current daily cloud quota, reserved amount, consumed amount, or remaining amount
- **AND** the dashboard does not disclose other operators' quota data

#### Scenario: Operator submission exceeds quota
- **WHEN** an operator submits a job that would exceed the remaining daily cloud quota
- **THEN** the dashboard shows a clear quota rejection message
- **AND** the dashboard does not show the job as accepted or processing

### Requirement: Non-admin dashboard isolation
The dashboard SHALL not expose governance controls to ordinary operators.

#### Scenario: Non-admin opens the dashboard
- **WHEN** an authenticated operator who is not an administrator opens the dashboard
- **THEN** the governance panel and audit controls are hidden
- **AND** the operator can continue using ordinary job submission and archive features
