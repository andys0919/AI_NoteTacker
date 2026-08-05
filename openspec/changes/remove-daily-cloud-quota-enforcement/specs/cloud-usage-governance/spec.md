## ADDED Requirements
### Requirement: Daily cloud budget is informational
The system SHALL NOT reject an otherwise valid job submission because its
estimated cloud reservation exceeds the submitter's remaining daily cloud
budget. The system SHALL continue to preserve the job's reservation estimate
and actual provider usage for reporting and settlement.

#### Scenario: Submission exceeds remaining daily budget
- **WHEN** an operator submits an otherwise valid meeting-link or uploaded-media job
- **AND** its estimated cloud reservation exceeds the remaining daily cloud budget
- **THEN** the system accepts the job subject to normal queue and input policy
- **AND** it stores the reservation estimate and quota-day identity

#### Scenario: Accepted over-budget job incurs provider usage
- **WHEN** an accepted job reports cloud provider usage
- **THEN** the system settles that usage through the existing immutable ledger
- **AND** cost and unpriced-usage reporting remain available
