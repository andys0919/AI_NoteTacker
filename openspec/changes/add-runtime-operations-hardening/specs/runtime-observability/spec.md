## ADDED Requirements
### Requirement: Core runtime health metrics
The system SHALL emit runtime health signals for queue depth, lease age and churn, stage latency, upload throughput, failure rates, and capacity saturation.

#### Scenario: Maintainer inspects runtime health
- **WHEN** maintainers query runtime health for the active deployment
- **THEN** the system can report current queue depth and saturation by scarce pool, recent stage latency, recent failure counts, and current lease-age data
- **AND** the signals come from durable or periodically refreshed runtime metrics rather than ad hoc log scraping

### Requirement: Machine-readable health reporting
The system SHALL provide a stable health reporting surface that privileged users can use for dashboards or alerting.

#### Scenario: Privileged health client requests runtime summary
- **WHEN** an authorized administrator or privileged operator requests runtime health data
- **THEN** the system returns machine-readable health summaries suitable for dashboards or alerts
- **AND** ordinary operators do not gain access to privileged runtime-health data for other users
