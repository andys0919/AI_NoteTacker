## ADDED Requirements

### Requirement: Dedicated stateless Codex PTY summary execution

The system SHALL generate meeting summaries through an authenticated
AI_NoteTacker-owned instance of the shared `claude-telegram-bot` Prompt API.
The runtime SHALL use `codex-pty`, `gpt-5.6-luna`, reasoning effort `max`,
and a fresh native session for every accepted prompt.

#### Scenario: Summary generation succeeds

- **WHEN** a summary-enabled job has a completed transcript
- **THEN** the worker sends its existing summary prompt to the dedicated Prompt API
- **AND** the runtime executes the prompt through Codex PTY with Luna/max
- **AND** the worker validates and stores the existing structured summary artifact

#### Scenario: Consecutive jobs are generated

- **WHEN** two summary jobs run consecutively
- **THEN** each job receives a new native Codex session
- **AND** neither job receives memory or user-profile context from the other

#### Scenario: Codex PTY cannot complete the summary

- **WHEN** authentication, transport, timeout, PTY, quota, or response validation fails
- **THEN** the job records the existing explicit summary-stage failure
- **AND** no Azure summary request is attempted
