# meeting-summary-generation Specification

## Purpose
Define how summary generation outcomes are represented so operators can distinguish successful, pending, and failed summary work.
## Requirements
### Requirement: Explicit summary-stage outcomes
The system SHALL expose summary stage outcomes explicitly instead of reducing summary failures to hidden worker-side logs.

#### Scenario: Summary generation succeeds after transcript completion
- **WHEN** a summary-enabled job completes summary generation successfully
- **THEN** the job stores the summary artifact
- **AND** the operator can see that summary generation finished successfully

#### Scenario: Summary generation fails after transcript completion
- **WHEN** a summary-enabled job encounters a summary-stage failure
- **THEN** the job records an explicit summary-stage failure outcome visible to the operator
- **AND** the failure is not reduced to console-only logging
