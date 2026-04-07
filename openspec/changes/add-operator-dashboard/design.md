## Context
The current control-plane is API-only and models a single queue of recording jobs. The frontend request adds a shared operations surface for multiple anonymous users, but with fair queueing semantics: one actively processing job per operator at a time, while additional jobs can remain queued. The system also needs an upload path for prerecorded audio, which bypasses browser meeting join and goes straight into transcription and summary.

## Goals / Non-Goals
- Goals:
  - Serve a usable operator dashboard from the existing control-plane.
  - Add anonymous operator identity without introducing accounts or passwords.
  - Support both meeting-link jobs and uploaded-audio jobs.
  - Preserve existing recording/transcription/summary workers with minimal new moving parts.
- Non-Goals:
  - Full user authentication or admin RBAC.
  - Rich collaboration features like shared editing or comments.
  - Multi-bot parallel meeting capacity beyond current worker limits.

## Decisions
- Decision: Use a client-generated anonymous `submitterId` persisted in browser `localStorage`.
  - Alternatives considered: cookies issued by the backend, one-time login codes.
- Decision: Extend `RecordingJob` with `inputSource`, `submitterId`, `requestedJoinName`, and optional uploaded-audio metadata.
  - Alternatives considered: separate job tables/types for uploads.
- Decision: Keep the frontend as static HTML/CSS/JS served by Express rather than introducing a separate SPA toolchain.
  - Alternatives considered: React/Vite app in a new workspace.
- Decision: Uploaded audio jobs enter as `queued` jobs with a recording artifact already attached and are claimed directly by the transcription worker.
  - Alternatives considered: immediate `transcribing` state with no queueing.

## Risks / Trade-offs
- Anonymous identity is spoofable by design.
  - Mitigation: treat it as a lightweight operator convenience feature, not security.
- Queue semantics become more complex because claimers must skip queued jobs when the same operator already has an active one.
  - Mitigation: keep the rule explicit in repository claim methods and cover with tests.
- Static frontend means less component structure than a SPA.
  - Mitigation: keep the UI deliberately small and operational.

## Migration Plan
1. Add domain/repository fields and schema changes.
2. Add operator-focused submission/list APIs and upload handling.
3. Update worker claim logic for per-operator concurrency.
4. Add the static dashboard and wire it to the new APIs.

## Open Questions
- None for the current implementation; use the provided default bot name and anonymous browser identity.
