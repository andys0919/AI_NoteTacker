## ADDED Requirements

### Requirement: Quota fallback credentials remain isolated

The production summary worker SHALL receive Azure summary endpoint/key values
only for fallback execution and SHALL keep them out of the control plane,
browser, logs, Codex subprocess environment, and app-server quota request. The
product SHALL not accept a user-supplied Codex OAuth token.

#### Scenario: Maintainer verifies the production summary worker

- **WHEN** the quota-fallback deployment is prepared for service
- **THEN** Local Codex remains the configured primary summary provider
- **AND** only the summary worker has the Azure summary endpoint/key variable names
- **AND** the worker can read a structured Codex rate-limit snapshot without exposing authentication material
- **AND** a controlled Local Codex summary succeeds without creating Azure usage
- **AND** rollout verification does not force a paid Azure request when Codex allowance is available
