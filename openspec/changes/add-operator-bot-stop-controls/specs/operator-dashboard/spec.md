## MODIFIED Requirements
### Requirement: Per-operator active job limit
The dashboard SHALL allow an operator to stop their own currently active meeting bot job and SHALL show runtime-aware job state when the meeting bot is already active.

#### Scenario: Operator stops current meeting bot
- **WHEN** an operator has an active meeting-link job and requests a stop from the dashboard
- **THEN** the system restarts or terminates the underlying meeting-bot runtime
- **AND** the operator's active meeting job enters a finalizing/exit-requested path instead of immediate failure
- **AND** the system can still accept the recording-completion webhook and continue into transcription if recording finalization succeeds

#### Scenario: Dashboard shows recording while bot is busy
- **WHEN** an operator's meeting-link job is in `joining` internally but the meeting-bot runtime reports busy
- **THEN** the dashboard displays that job as `recording`

#### Scenario: Worker claims wait while the meeting bot runtime is busy
- **WHEN** the shared meeting-bot runtime reports that it is already busy
- **THEN** recording-worker claim requests do not start another queued meeting-link job

#### Scenario: Idle runtime clears stale meeting jobs
- **WHEN** the meeting-bot runtime is idle but a meeting-link job is still stuck in `joining` or `recording` beyond the stale-job threshold
- **THEN** the system marks that stale job failed with an explicit stale-runtime reason
- **AND** the next eligible queued meeting-link job may be claimed
