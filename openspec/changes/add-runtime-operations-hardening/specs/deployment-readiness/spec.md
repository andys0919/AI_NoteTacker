## ADDED Requirements
### Requirement: Replica-safe deployment guidance
The project SHALL document replica-safe configuration and rolling-upgrade procedures before recommending a multi-instance control-plane or worker deployment.

#### Scenario: Maintainer prepares a replicated deployment
- **WHEN** maintainers plan a deployment with multiple control-plane or worker instances
- **THEN** the project documents shared dependency assumptions, upgrade order, and replica-safe configuration constraints
- **AND** the procedure avoids duplicate stage ownership or public exposure of internal routes during rollout

### Requirement: Capacity evolution guidance
The project SHALL document when operators should move beyond the initial fixed-capacity rollout profile to larger fixed pools or autoscaled capacity.

#### Scenario: Sustained saturation exceeds the declared rollout profile
- **WHEN** maintainers observe queue saturation or recovery times outside the declared thresholds for the current profile
- **THEN** the project provides decision criteria for increasing fixed capacity or introducing autoscaling
- **AND** the guidance ties those changes to a named next rollout profile
