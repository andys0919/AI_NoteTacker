## ADDED Requirements
### Requirement: Policy-aligned artifact retention
The system SHALL define retention policy for uploaded media, recordings, transcripts, and summaries independently from dashboard list visibility.

#### Scenario: Terminal job records artifact lifecycle policy
- **WHEN** a job reaches a terminal state
- **THEN** the system records the retention or deletion policy that applies to each stored artifact class
- **AND** maintainers can determine whether artifacts are retained, expired later, or deleted immediately

### Requirement: Delete flows apply artifact cleanup semantics
The system SHALL align operator delete and clear-history flows with artifact cleanup behavior instead of deleting metadata only.

#### Scenario: Operator deletes one terminal job
- **WHEN** an operator deletes one owned terminal job
- **THEN** the system applies the configured cleanup or retention behavior to that job's stored artifacts
- **AND** the operator-visible result distinguishes metadata removal from pending or completed object cleanup

#### Scenario: Operator clears terminal history in bulk
- **WHEN** an operator clears terminal job history
- **THEN** the system applies the configured artifact lifecycle policy to each affected job
- **AND** artifact cleanup work can continue safely even after those jobs leave the visible archive
