## MODIFIED Requirements
### Requirement: Authenticated terminal job email notifications
The system SHALL send terminal job email notifications to authenticated operators when notification delivery is configured and surface that capability clearly in the dashboard.

#### Scenario: Signed-in operator sees email notification status
- **WHEN** a signed-in operator opens the dashboard
- **THEN** the dashboard shows whether terminal email notifications are available for authenticated jobs
- **AND** completed or failed jobs can display whether an email notification was already sent

### Requirement: Optional browser terminal notifications
The dashboard SHALL let an operator enable browser notifications for terminal job outcomes while the dashboard remains open.

#### Scenario: Browser notifications enabled for a terminal job
- **WHEN** the operator has granted browser notification permission and enabled browser notifications in the dashboard
- **AND** one of the operator's jobs transitions into `completed` or `failed`
- **THEN** the browser surfaces a notification describing the terminal outcome
- **AND** the dashboard does not create duplicate browser alerts for the same terminal state
