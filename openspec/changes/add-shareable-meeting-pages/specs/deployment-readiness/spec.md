## ADDED Requirements

### Requirement: Canonical runtime credentials are explicit and fail closed

The canonical deployment SHALL require at least 32 UTF-8 bytes for the dedicated
internal-service credential and at least 6 UTF-8 bytes for the admin-console
password, and SHALL NOT accept source-controlled legacy passwords or documented
placeholders.

#### Scenario: Required runtime credential is absent

- **WHEN** canonical Compose is rendered or the canonical server starts without
  an internal-service token or admin-console password
- **THEN** configuration or startup fails before the service becomes available
- **AND** tests use explicit test-only credentials rather than production
  fallbacks

#### Scenario: Legacy or undersized admin password is configured

- **WHEN** the canonical server receives the former documented admin password
  or any admin password shorter than 6 UTF-8 bytes
- **THEN** startup fails before persistence or scheduled work begins

### Requirement: Canonical backing services remain private

The canonical deployment SHALL keep PostgreSQL and MinIO on its private Compose
network and SHALL require explicitly configured credentials for both services.

#### Scenario: Canonical Compose is rendered for deployment

- **WHEN** the canonical Compose configuration is resolved with all required
  credentials
- **THEN** PostgreSQL port 5432 and MinIO ports 9000 and 9001 are not published
  on the host
- **AND** PostgreSQL, MinIO, the ScreenApp uploader, and MinIO bucket setup use
  explicitly supplied credentials instead of source-controlled defaults

#### Scenario: ScreenApp forwards internal callbacks

- **WHEN** canonical ScreenApp Compose starts the recording worker and meeting bot
- **THEN** the join payload uses the same required internal-service credential as
  the callback base URL
- **AND** it does not retain a source-controlled bearer placeholder
