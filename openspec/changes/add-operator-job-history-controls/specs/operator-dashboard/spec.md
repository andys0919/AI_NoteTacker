## ADDED Requirements
### Requirement: Operator history cleanup
The dashboard SHALL let an operator remove terminal jobs from their own visible history without affecting active processing jobs or jobs owned by other operators.

#### Scenario: Operator deletes a terminal job
- **WHEN** an operator requests deletion of one of their own jobs in `failed` or `completed`
- **THEN** the system removes that job from persistent operator history
- **AND** subsequent job listings for that operator omit the deleted job

#### Scenario: Operator attempts to delete an active job
- **WHEN** an operator requests deletion of one of their own jobs in `queued`, `joining`, `recording`, or `transcribing`
- **THEN** the system rejects the request
- **AND** the job remains unchanged

### Requirement: Bulk clear terminal history
The dashboard SHALL let an operator clear their own terminal job history in one action.

#### Scenario: Operator clears history while active jobs still exist
- **WHEN** an operator requests bulk history clearing while they have both active and terminal jobs
- **THEN** the system deletes only that operator's `failed` and `completed` jobs
- **AND** that operator's active jobs remain unchanged
- **AND** jobs owned by other operators remain unchanged
