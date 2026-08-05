# Change: Remove Unused Runtime Scaffolding

## Why
The repository still carries runtime services, cross-worker configuration, an external package boundary, browser modules, tests, wrappers, and planning artifacts that no active execution path uses. This increases deployment and maintenance cost while obscuring the actual transcription, summary, authentication, and operator contracts.

## What Changes
- Remove the unused Redis service and its configuration/documentation.
- Remove the external `meeting-ai-pipeline` dependency and keep the artifact downloader inside the transcription worker, which is its only production consumer.
- Keep transcription and summary execution independently schedulable while giving each service only the settings and resources it consumes.
- Remove unreachable browser authentication modules, obsolete worker collaborators/tests, dead exported helpers, and a test-only runtime-state module.
- Remove completed scratch planning records, the duplicate multilingual design document, the wrapper-only Makefile, and the one-line browser entrypoint.
- Update canonical commands and project/runtime documentation to match the simplified implementation.
- Preserve backend authentication, internal-service authentication, transcript evidence fields, cloud settlement validation, provider behavior, and all recording-job lifecycle semantics.

## Impact
- Tracking ticket: `andys0919/AI_NoteTacker#1`
- Affected specs: `deployment-readiness`, `meeting-ai-pipeline-package`, `repository-maintainability`
- Supersedes active completed changes: `extract-meeting-ai-pipeline-package`, `externalize-meeting-ai-pipeline-dependency`
- Future archive order: `extract-meeting-ai-pipeline-package` → `externalize-meeting-ai-pipeline-dependency` → `remove-unused-runtime-scaffolding`
- Affected code: Docker Compose files, transcription/summary worker configuration and tests, browser assets/tests, control-plane dead exports, Python build/test wiring, operational documentation
- No database migration, public API change, deployment, commit, push, or pull request is included
