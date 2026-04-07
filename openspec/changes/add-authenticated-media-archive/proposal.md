# Change: Add Authenticated Media Archive

## Why
The current operator dashboard was built for anonymous queue submission, which is no longer sufficient for multi-user production use. Operators now need identity-backed access, durable archives they can revisit later, upload support for both audio and video files, and clear stage-by-stage progress while jobs move through extraction, transcription, and summarization.

The current uploaded-media path also leaves operators with poor visibility when a job reaches `transcribing` and stalls or runs for a long time. That is acceptable for a prototype, but not for a system expected to serve roughly 100 concurrent named users without ownership conflicts or archive ambiguity.

## What Changes
- **BREAKING** Replace anonymous browser-local operator identity with email OTP sign-in backed by Supabase Auth and custom SMTP delivery via Brevo Free.
- Add user-scoped job ownership and archive visibility so completed transcripts and summaries can be revisited later from any signed-in browser.
- Add archive search so authenticated operators can quickly find prior jobs by file name, meeting link, transcript text, or summary text.
- Add archive export so operators can download transcript and summary outputs in reusable formats.
- Add terminal job email notifications so authenticated operators can be notified when their jobs complete or fail.
- Add GPU-aware transcription slot gating so uploaded-media jobs queue instead of oversubscribing a shared GPU.
- Accept both uploaded audio and uploaded video files, store the raw upload durably, and extract a canonical audio derivative before transcription.
- Expand job lifecycle tracking to persist stage progress, stage detail messages, worker heartbeats, and user-visible progress history.
- Add stale transcription lease recovery so crashed transcription workers do not leave uploaded-media jobs stuck forever.
- Persist transcript and summary outputs as durable archive artifacts instead of transient dashboard-only display blocks.
- Introduce queue and worker coordination changes that avoid cross-user conflicts under higher concurrency.

## Impact
- Affected specs: `operator-dashboard`, `user-authentication`, `media-ingestion`, `job-progress-tracking`, `transcript-archive`
- Affected code: control-plane auth/session middleware, dashboard frontend, PostgreSQL schema and repositories, upload storage, worker orchestration, transcription/media-preparation runtime, Docker compose/runtime configuration
