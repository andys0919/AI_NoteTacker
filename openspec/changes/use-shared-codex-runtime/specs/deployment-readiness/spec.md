## ADDED Requirements

### Requirement: AI_NoteTacker owns an isolated Codex PTY runtime

The production deployment SHALL run AI_NoteTacker's Prompt API in its own
shared-runtime process with a dedicated `CODEX_HOME`, PTY daemon namespace,
session storage, bearer token, and empty project-local working directory. The
OAuth account MAY be the same account used by the other bots, but writable
runtime state SHALL NOT be shared between processes.

#### Scenario: Runtime is deployed

- **WHEN** maintainers deploy the AI_NoteTacker summary workload
- **THEN** the agent health endpoint succeeds
- **AND** missing or invalid Prompt API bearer authentication is rejected
- **AND** the summary worker and agent share the AI_NoteTacker Compose network
- **AND** the agent does not expose its Prompt API as a public host port

#### Scenario: Concurrent bots use the shared account

- **WHEN** Report and AI_NoteTacker execute Codex PTY turns at the same time
- **THEN** both complete through their own runtime process and PTY namespace
- **AND** neither process adopts the other's native session or writable state
