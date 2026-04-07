## ADDED Requirements
### Requirement: Authenticated terminal job email notifications
The system SHALL send terminal job email notifications to authenticated operators when notification delivery is configured.

#### Scenario: Completed job sends one notification
- **WHEN** an authenticated operator's job reaches `completed`
- **AND** a notification transport is configured
- **THEN** the system sends one email notification to that operator's authenticated email address
- **AND** later saves of the same terminal job do not send duplicates

#### Scenario: Failed job sends one notification
- **WHEN** an authenticated operator's job reaches `failed`
- **AND** a notification transport is configured
- **THEN** the system sends one email notification describing the failure outcome

#### Scenario: Anonymous or unconfigured notification path sends nothing
- **WHEN** a terminal job belongs to an anonymous operator or no notification transport is configured
- **THEN** the system does not attempt email delivery
- **AND** the job lifecycle still completes normally
