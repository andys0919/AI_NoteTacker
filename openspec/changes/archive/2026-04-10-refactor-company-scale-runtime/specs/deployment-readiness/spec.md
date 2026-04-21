## ADDED Requirements
### Requirement: Declared rollout profile
The project SHALL define the workload assumptions and minimum deployment topology behind any claim that the service is ready for a 100-person company rollout.

#### Scenario: Maintainer prepares a 100-user internal rollout
- **WHEN** maintainers describe a deployment as ready for a 100-person company
- **THEN** the project documentation names the supported peak concurrent live meetings, uploaded transcriptions, summary workload, retention assumptions, and required topology
- **AND** the readiness claim is tied to that declared rollout profile instead of a seat count alone

### Requirement: Repeatable rollout verification
The project SHALL provide repeatable load and recovery verification steps with explicit pass/fail gates for the declared rollout profile.

#### Scenario: Maintainer validates the declared rollout profile before go-live
- **WHEN** maintainers prepare to roll out the declared profile
- **THEN** the project provides documented scripts or repeatable procedures for burst uploads, overlapping live-meeting submissions, worker restarts, and queue-drain checks
- **AND** the documentation defines pass/fail thresholds for correctness, recovery behavior, and overload handling
