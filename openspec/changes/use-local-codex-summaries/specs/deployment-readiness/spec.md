## ADDED Requirements

### Requirement: Local Codex summary authentication is isolated from the product

The production summary worker SHALL use a protected dedicated Docker volume for
`CODEX_HOME`, SHALL NOT mount the host user's default Codex home, and the
application SHALL not expose a field for a user-supplied OAuth token. Any later
Azure fallback credential SHALL remain confined to the summary worker.

Codex summarization SHALL treat transcript text as untrusted data: the prompt
SHALL be delivered over stdin, command-execution tools and user configuration
SHALL be disabled, and the Codex child environment SHALL exclude worker service
credentials. A finite wall-clock timeout SHALL end a stalled Codex process and
route it through the normal summary-failure lifecycle.

#### Scenario: Maintainer verifies the production summary worker

- **WHEN** the local-Codex deployment is prepared for service
- **THEN** the summary worker reports a valid Codex login and the configured model is available
- **AND** `/codex-home` is a read/write named-volume mount that is separate from the host user's default Codex home
- **AND** the control plane, transcription worker, and browser exclude Azure summary endpoint/key variables
- **AND** the Codex child process excludes the internal service token and cannot execute transcript-requested shell commands
- **AND** the control plane and browser never read or display the underlying authentication material
