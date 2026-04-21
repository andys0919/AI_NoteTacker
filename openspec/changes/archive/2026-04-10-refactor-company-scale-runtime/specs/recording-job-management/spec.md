## ADDED Requirements
### Requirement: Completion waits for configured stages
The system SHALL treat a job as fully completed only after every configured processing stage for that job has reached an explicit terminal outcome.

#### Scenario: Summary-enabled job remains non-terminal after transcript persistence
- **WHEN** a job has a transcript artifact
- **AND** the job configuration still requires summary generation
- **THEN** the job does not transition directly to fully `completed`
- **AND** the operator can still see that summary work is pending or active

#### Scenario: Summary-disabled job completes after transcript persistence
- **WHEN** a job has a transcript artifact
- **AND** the job configuration does not require any later summary stage
- **THEN** the job may transition to fully `completed`
- **AND** the operator can retrieve the finished transcript result immediately

### Requirement: Summary is independently schedulable work
The system SHALL expose summary generation as independently claimable work so transcript throughput does not depend on summary duration.

#### Scenario: Transcript worker releases capacity after transcript completion
- **WHEN** a transcription worker finishes transcript persistence for a summary-enabled job
- **THEN** the transcription stage lease is released
- **AND** summary work becomes separately claimable by summary execution capacity

#### Scenario: Summary backlog does not block unrelated transcript work
- **WHEN** summary execution capacity is saturated
- **THEN** later transcript-ready jobs can still claim available transcription capacity
- **AND** summary backlog alone does not halt transcript scheduling

### Requirement: Scarce capacity uses explicit backlog policy
The system SHALL enforce configured concurrency and backlog limits for live-meeting capture and other scarce processing pools instead of allowing unbounded hidden backlog.

#### Scenario: Capacity is full but bounded backlog remains
- **WHEN** live-meeting capture capacity is exhausted
- **AND** the remaining configured backlog limit has not been exceeded
- **THEN** a newly accepted meeting-link job enters an explicit capacity-waiting state
- **AND** the system does not imply that active recording has already begun

#### Scenario: Backlog limit is exhausted
- **WHEN** the configured backlog limit for a scarce pool has already been reached
- **THEN** the system rejects additional submissions with a clear capacity-related failure
- **AND** it does not create an unbounded hidden queue
