## ADDED Requirements
### Requirement: Explicit stage lease heartbeats
The system SHALL persist explicit heartbeat metadata for claimed stages so long-running work can renew ownership and expose lease age without relying only on generic row updates.

#### Scenario: Healthy worker renews a long-running lease
- **WHEN** a worker continues processing a claimed stage past one heartbeat interval
- **THEN** the system records a renewed heartbeat or lease timestamp for that stage
- **AND** privileged runtime-health surfaces can determine how old the current lease is

#### Scenario: Worker stops heartbeating before completion
- **WHEN** a claimed stage stops heartbeating past the reclaim threshold
- **THEN** the system may reclaim the stage for another worker
- **AND** the stale lease is distinguishable from a healthy active lease
