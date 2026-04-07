## Context

The current product state is still optimized for anonymous operators working in a single browser. Job ownership is derived from a locally generated identifier, uploaded media enters the transcription pipeline directly, and the dashboard only exposes coarse job states. This is insufficient for the next product step, where named users must sign in with email, upload either audio or video, observe real progress, and reliably revisit old transcripts and summaries later.

Two concrete findings drive this change:
- Uploaded `.m4a` jobs do reach the pipeline today, but the dashboard provides too little progress information, so users perceive the workflow as unresponsive once a job sits in `transcribing`.
- Durable archive access cannot be built correctly on top of anonymous browser-local identity because the same user may return on another browser or device, and multiple people can currently impersonate each other by reusing an arbitrary identifier.

## Goals / Non-Goals

**Goals**
- Authenticate operators with passwordless email OTP while keeping the login UX to “enter your email only.”
- Support durable ownership and archive access across browsers and devices.
- Accept uploaded audio and uploaded video, preserve the raw file, and create a canonical extracted-audio derivative for downstream transcription.
- Persist stage-level progress and job history so active and completed work is observable.
- Preserve transcript and summary outputs as durable records that can be revisited later.
- Keep worker coordination safe under roughly 100 named users sharing the system.

**Non-Goals**
- No custom password system.
- No social logins or enterprise SSO in this change.
- No live in-meeting streaming transcript UI; the focus remains async job processing.
- No multi-tenant organization/role model beyond per-user ownership and future admin extensibility.

## Decisions

### 1. Use Supabase Auth for email OTP identity and Brevo Free as the SMTP provider

The frontend will sign users in through Supabase Auth passwordless email OTP. Supabase will send the one-time code email and manage the session lifecycle after verification, while Brevo Free SMTP will deliver production emails without requiring the project to operate its own mail server. The control-plane backend will verify Supabase-issued JWTs using the project's JWKS endpoint and cache the verification keys.

This avoids building a custom token issuance system while still giving the backend a strong, verifiable user identity. It also removes the fragility of internal-network redirect handling because the user completes verification on the same page instead of relying on a redirect callback.

Alternative considered:
- Local custom magic-link tokens plus self-managed SMTP.
Reason rejected:
- More moving parts, worse deliverability, and unnecessary authentication risk.

### 2. Keep local PostgreSQL as the system of record for jobs and archives

Supabase Auth will provide identity, but the local control-plane PostgreSQL database remains the source of truth for jobs, stage progress, transcripts, summaries, and archive metadata. The backend will mirror authenticated users into a local `users` table keyed by the Supabase user ID, not by raw email text alone.

This keeps the operational queue and archive model under the product's direct control and prevents archive integrity from depending on browser-local identifiers.

Alternative considered:
- Move all application data into Supabase database tables.
Reason rejected:
- The current project already centers on local PostgreSQL and local infrastructure; moving the full data plane would expand scope without solving the core workflow problem.

### 3. Split uploaded-media processing into raw upload, media preparation, transcription, and summary stages

Uploaded media will no longer flow straight from object storage into Whisper as an opaque blob. Instead:
- Raw upload artifact is stored durably first.
- A media-preparation worker extracts or normalizes a canonical audio derivative using FFmpeg.
- The transcription worker consumes the prepared audio.
- The summary worker or summary stage derives the final summary after transcription succeeds.

This makes video support explicit, avoids relying on downstream libraries to infer the right input handling, and gives the dashboard an honest progression timeline.

Alternative considered:
- Continue sending raw uploaded files directly to the transcription step.
Reason rejected:
- Too little observability, weaker failure isolation, and no explicit place to support video-to-audio extraction.

### 4. Persist stage progress as first-class data, not as inferred UI state

Each job will persist:
- Current stage
- Stage detail message
- Stage attempt count
- Last worker heartbeat timestamp
- Timestamped stage events/history

The dashboard will render from this stored progress data rather than guessing from a single state string. Stage history will be user-visible for active jobs and retained for completed or failed archives.

Alternative considered:
- Keep the current coarse `state` model and refresh the dashboard more often.
Reason rejected:
- More polling does not fix missing observability or provide durable auditability.

For the first implementation slice, the existing `recording_jobs.updated_at` timestamp may act as the effective heartbeat for transcription claims and progress events. That allows stale transcription recovery to ship before a dedicated heartbeat table or per-stage heartbeat columns exist. Once stage history becomes first-class data, explicit heartbeat timestamps can replace this surrogate.

### 5. Store canonical transcript and summary records durably for archive revisit

The system will treat transcript and summary as durable artifacts, not just transient job decorations. The canonical JSON transcript and summary payload may live in object storage, while PostgreSQL stores archive metadata and a query-friendly projection of transcript text and summary text for UI retrieval.

This supports “open the job later and read everything again” without relying on the client to have cached prior responses.

Alternative considered:
- Only keep transcript/summary inside the job row as lightweight JSON.
Reason rejected:
- Large transcripts will bloat the hot jobs table and make archive evolution harder.

The first archive search slice will use the already persisted job projection and filter across:
- meeting link
- uploaded file name
- requested join name
- transcript text projection
- summary text projection

This delivers practical archive retrieval now without waiting for a separate full-text indexing subsystem. If archive scale grows, PostgreSQL full-text indexes or a dedicated search service can be introduced later without changing the user-facing search model.

### 5a. Send terminal job email notifications only for authenticated operators and only once per job

Terminal notifications will target the authenticated operator email already mirrored in the local user repository. The control-plane will attempt notification only when:
- the job reaches a terminal state (`completed` or `failed`)
- a notification sender is configured
- the submitter resolves to a known authenticated user email
- that terminal state has not already been notified

The job record will persist notification delivery metadata so later saves, such as `summary-artifact-stored` after a prior `transcript-artifact-stored`, do not send duplicates.

The first slice will use SMTP delivery through a configured transport because that aligns with the existing Brevo-backed email direction and avoids introducing a second notification channel before the authenticated product path is stable.

### 6. Scale through stage-specific worker pools and durable leases

To reduce cross-user conflicts under roughly 100 users:
- Meeting-link recording jobs keep their own queue and worker pool.
- Uploaded-media preparation jobs use a separate worker pool.
- Transcription jobs use a separate worker pool.
- Summary generation uses its own stage or worker pool.

Each stage lease will be durable in PostgreSQL with heartbeat timestamps and reclaim logic so crashed workers do not leave jobs stuck forever. Ownership remains per user, but execution capacity is global and horizontally scalable by worker class.

Alternative considered:
- Continue using a single coarse claim flow for all uploaded jobs.
Reason rejected:
- Harder to reason about stage ownership, retries, bottlenecks, and large-file processing under concurrency.

## Risks / Trade-offs

- [Supabase hosted auth dependency] -> Limit Supabase usage to identity only, keep local PostgreSQL and artifacts as the core data plane.
- [Brevo free-tier delivery limits] -> Treat it as the initial provider and document the later upgrade path without changing the auth flow.
- [Video preparation cost] -> Make media preparation an explicit worker stage so it scales independently from transcription.
- [Archive schema growth] -> Separate archive projections from the hot job queue path and avoid stuffing all content into the main jobs table.
- [JWT verification complexity] -> Use asymmetric signing and JWKS verification so backend validation remains cacheable and stateless.

## Migration Plan

1. Add authenticated-user schema and local user mapping.
2. Add backend auth middleware and protect operator/archive APIs.
3. Update the dashboard from anonymous local identity to signed-in identity.
4. Introduce new upload and archive tables/artifacts without deleting existing jobs immediately.
5. Add media-preparation stage and worker, then route uploaded audio/video through it.
6. Add progress-event persistence and archive listing/detail APIs.
7. Migrate or hide legacy anonymous jobs from the authenticated archive experience.

Rollback strategy:
- If Supabase integration blocks rollout, keep the legacy anonymous dashboard path behind a feature flag while continuing development on the authenticated path.

## Open Questions

- Whether transcript text should be split into searchable segments in PostgreSQL immediately or stored first as a single document projection.
- Whether summary generation should stay inside the transcription worker or move to its own dedicated stage once archive throughput grows.
