## ADDED Requirements

### Requirement: Uploaded-media size failures are bounded and structured
The system SHALL enforce an explicit uploaded-media byte limit while keeping request bodies file-backed and SHALL return a structured client error when the limit is exceeded.

#### Scenario: Supported video fits the default upload boundary
- **WHEN** an operator uploads supported audio or video no larger than 512 MiB
- **THEN** the control plane accepts it for durable streamed storage subject to normal quota and queue policy
- **AND** it does not require the full body to remain in application memory

#### Scenario: Upload exceeds the configured byte limit
- **WHEN** an uploaded file exceeds the configured byte limit
- **THEN** the control plane returns HTTP 413 with error code `uploaded-media-too-large`
- **AND** it does not return an Express HTML HTTP 500
- **AND** Multer removes or the control plane cleans up the partial temporary file
