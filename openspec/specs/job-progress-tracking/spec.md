# job-progress-tracking Specification

## Purpose
Define how runnable stages are claimed, reclaimed, and updated so concurrent workers and retries preserve correct job state.
## Requirements
### Requirement: Atomic stage lease claims
The system SHALL claim each runnable stage through an atomic lease mutation that prevents more than one worker from owning the same stage at the same time.

#### Scenario: Two workers race for the same queued stage
- **WHEN** two workers attempt to claim the same eligible queued stage concurrently
- **THEN** exactly one worker receives the stage lease
- **AND** the other worker does not begin processing that same stage

#### Scenario: Expired stage lease is reclaimed safely
- **WHEN** a worker lease expires without renewal or terminal stage completion
- **THEN** the system may reclaim that stage for a later worker
- **AND** the reclaimed lease does not require manual database repair

### Requirement: Idempotent worker stage callbacks
The system SHALL treat repeated or stale worker callbacks for a stage as idempotent so later retries do not corrupt job state or duplicate downstream effects.

#### Scenario: Duplicate completion callback is retried
- **WHEN** a worker or network intermediary retries the same transcript or summary completion callback
- **THEN** the system preserves one logical stage completion
- **AND** duplicate artifacts, duplicate usage writes, and duplicate settlement do not occur

#### Scenario: Callback arrives from an older superseded lease
- **WHEN** a stale worker callback arrives after a newer lease has already claimed or completed the same stage
- **THEN** the system ignores or safely no-ops that stale callback
- **AND** the newer lease outcome remains authoritative
