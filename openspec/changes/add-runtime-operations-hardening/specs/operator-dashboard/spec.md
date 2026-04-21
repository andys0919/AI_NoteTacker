## ADDED Requirements
### Requirement: Privileged runtime health visibility
The dashboard SHALL provide a privileged runtime health view for queue saturation, lease age, stage failures, and cleanup backlog without exposing other operators' job content.

#### Scenario: Administrator opens runtime health view
- **WHEN** an authorized administrator opens the runtime health view
- **THEN** the dashboard shows system-wide scarce-pool queue depth, recent failure rates, stuck or aging leases, and cleanup backlog indicators
- **AND** the view distinguishes runtime-health signals from ordinary per-job status cards

#### Scenario: Ordinary operator opens dashboard
- **WHEN** a non-privileged operator opens the dashboard
- **THEN** the runtime health view does not expose system-wide queue, lease, or cleanup data
- **AND** the operator continues to see only their own job list and capacity messages
