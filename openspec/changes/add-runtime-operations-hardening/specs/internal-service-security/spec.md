## ADDED Requirements
### Requirement: Least-privilege meeting-bot control
The system SHALL let the control plane stop the managed meeting bot without granting the web process access to the host container runtime.

#### Scenario: Operator requests meeting exit
- **WHEN** an authorized operator requests the active meeting bot to stop
- **THEN** the control plane calls a private authenticated interface that can terminate only the meeting-bot process
- **AND** the control-plane container does not mount the host Docker socket

### Requirement: Repeated admin login failures are throttled
The system SHALL throttle repeated failed administrator password attempts without changing the configured administrator credential.

#### Scenario: One source repeatedly submits invalid credentials
- **WHEN** one source exceeds the allowed failed login attempts inside the configured window
- **THEN** further attempts receive a rate-limit response until the window expires
- **AND** no administrator session token is issued
