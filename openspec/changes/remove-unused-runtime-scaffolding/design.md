## Context

The transcription and summary stages are already independently scheduled, but both services still inherit configuration and resources from their former combined execution path. The Compose stack also starts Redis even though no application dependency opens a Redis connection. Separately, `meeting-ai-pipeline` is installed from Git and its sibling checkout is compiled and tested locally, while production imports only its artifact downloader and keeps the actual Whisper and Codex implementations in this repository.

The browser now runs in guest mode and loads `app.js`, but old OTP modules and their tests remain unreachable. Several completed planning logs, wrapper entrypoints, and exported helpers likewise have no active caller. These are maintenance artifacts, not product behavior.

## Goals / Non-Goals

**Goals:**
- Make runtime topology match actual runtime dependencies.
- Keep transcription and summary scheduling separate without cross-stage configuration or resource reservations.
- Put the artifact downloader next to its sole production consumer and remove the unused external package boundary.
- Delete unreachable code, obsolete tests, wrapper-only commands, and completed scratch records.
- Keep code, OpenSpec, README, worker documentation, and HANDOFF commands consistent.

**Non-Goals:**
- Change recording, transcription, punctuation, summary, quota, settlement, authentication, or notification behavior.
- Remove or weaken backend operator authentication, admin authentication, internal-service tokens, input validation, or transcript evidence.
- Split the shared worker image into multiple Dockerfiles or add a replacement dependency.
- Archive OpenSpec changes, deploy services, commit, push, or create a pull request.

## Decisions

### 1. Own the artifact downloader locally

The transcription worker will contain the existing HTTP download plus S3 fallback behavior and keep its focused regression test. The Docker image will stop installing `meeting-ai-pipeline`, local build/test commands will stop requiring a sibling checkout, and the unused package pipeline test will be removed.

This is smaller than extending an external abstraction that production does not otherwise use. It also removes a Git dependency from image builds without adding a new library.

### 2. Keep one image but remove stage-inappropriate runtime resources

The existing worker image remains shared because splitting it would add build and release machinery that is not required for correctness. Compose will stop reserving a GPU and passing transcription-only settings to `summary-worker`; it will stop mounting Codex state and passing summary-only settings to `transcription-worker`.

Configuration readers will no longer require Whisper settings when starting the summary process. The independently claimable summary lifecycle remains unchanged.

### 3. Delete only unreachable browser authentication code

The guest dashboard no longer imports the OTP browser client. Those browser modules and their tests will be removed, and `index.html` will load `app.js` directly. Backend Supabase verification, authenticated-user persistence, admin authorization, and notification behavior remain untouched.

### 4. Keep one authoritative record and one canonical command path

OpenSpec, maintained product/operations documentation, HANDOFF, and git history remain authoritative. Completed agent scratch logs and the parallel multilingual design copy will be deleted. Deployment documentation will call `scripts/deploy.sh` directly, and test documentation will use root npm scripts; the wrapper-only Makefile will be removed.

## Risks / Trade-offs

- Local downloader drift could change S3 fallback behavior. Mitigation: retain the existing downloader regression test and run the worker suite.
- Removing cross-stage environment values could hide an accidental dependency. Mitigation: use stage-specific configuration tests and render every Compose file combination.
- Deleting browser auth files could affect a hidden entrypoint. Mitigation: verify all static references and keep backend authentication unchanged.
- Removing Redis could invalidate a documentation-only topology assumption. Mitigation: verify dependency manifests and source references, then update project and rollout documentation.

## Migration Plan

1. Add the local downloader and remove the external package build/test wiring.
2. Remove unused Compose services, resources, and cross-stage settings.
3. Remove unreachable code/tests and wrapper artifacts.
4. Synchronize documentation and OpenSpec project context.
5. Run targeted and repository-level verification, then review the complete diff against this change and its ticket.

For future archiving, apply and revalidate the dependent changes in this exact
order: `extract-meeting-ai-pipeline-package`,
`externalize-meeting-ai-pipeline-dependency`, then
`remove-unused-runtime-scaffolding`. The first change creates the capability,
the second updates it, and this change removes it. Archiving this change before
both predecessors would leave the published specification inconsistent with the
implemented local-downloader design.

Rollback is a source-level revert; no persisted data or schema changes are involved.

## Open Questions

None. The user explicitly approved all findings in the preceding audit.
