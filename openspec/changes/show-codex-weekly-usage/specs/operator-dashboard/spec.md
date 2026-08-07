## ADDED Requirements

### Requirement: Administrator can inspect Codex weekly allowance

The system SHALL obtain the Local Codex allowance from the official
`account/rateLimits/read` response inside the summary worker and SHALL expose
only the provider-reported seven-day usage window to an authenticated
administrator. The interface SHALL show used percentage, remaining percentage,
reset time, and observation time without exposing Codex authentication material
or account identifiers.

#### Scenario: Codex returns a seven-day usage window

- **WHEN** the `codex` rate-limit bucket reports a 10,080-minute window
- **THEN** the admin settings show the provider-reported used percentage
- **AND** show the clamped remaining percentage as 100 minus used percentage
- **AND** show the provider reset time and the worker observation time
- **AND** present the usage with text in addition to a progress indicator

#### Scenario: Weekly usage is unavailable

- **WHEN** the Codex probe fails, has not reported, or omits a 10,080-minute window
- **THEN** the admin settings explicitly state that weekly usage is unavailable
- **AND** do not substitute a shorter quota window or fabricate a remaining percentage

#### Scenario: Non-admin requests Codex usage

- **WHEN** a request without administrator authorization reads the Codex usage endpoint
- **THEN** the system rejects the request
- **AND** returns no allowance or account information
