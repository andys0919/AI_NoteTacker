# operator-dashboard Specification

## Purpose
Define the runtime-facing job list and detail experience operators use to monitor queue state and inspect owned archive content.
## Requirements
### Requirement: Lightweight paginated job listing
The system SHALL provide a paginated operator job listing response that excludes full transcript and summary bodies by default.

#### Scenario: Dashboard refresh requests active and archived jobs
- **WHEN** the operator dashboard refreshes its job list
- **THEN** the list response returns lightweight card fields such as state, timestamps, costs, and brief previews
- **AND** the response does not include full transcript text or full summary text by default

#### Scenario: Large archive is browsed incrementally
- **WHEN** an operator has a large job archive
- **THEN** the archive list can be paginated or incrementally fetched
- **AND** the dashboard does not need to transfer every archived transcript body on each refresh

### Requirement: On-demand heavy archive detail retrieval
The system SHALL return full transcript and summary bodies only through explicit per-job detail or export retrieval paths.

#### Scenario: Operator opens one archived job
- **WHEN** an operator requests the details for one owned job
- **THEN** the system returns the heavy transcript and summary data for that job
- **AND** the list polling path remains lightweight for other jobs

### Requirement: Capacity-related waiting states are visible
The system SHALL show operators when a job is waiting on scarce execution capacity rather than actively processing.

#### Scenario: Job is queued behind scarce capacity
- **WHEN** a job is waiting for live-meeting, transcription, or summary capacity
- **THEN** the operator sees a capacity-specific waiting state or message
- **AND** the UI distinguishes capacity saturation from worker failure or ordinary stage progress
