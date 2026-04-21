# Findings

## Runtime Topology

- Default deployment is a single Docker Compose stack with one `control-plane`, one `recording-worker`, one `transcription-worker`, one `postgres`, one `redis`, and one `minio`.
- Full meeting-link workflow adds one shared `meeting-bot` runtime.
- README explicitly says meeting-link jobs are effectively single-slot and upload jobs share one transcription queue.
- `.env.example` sets `MAX_CONCURRENT_TRANSCRIPTION_JOBS=1`.

## Initial Scale Signal

- This stack can plausibly serve a 100-person company only if usage is low and staggered.
- It is not architected for 100 concurrent meeting captures or a bursty enterprise-wide transcription workload in its default shape.

## High-Risk Architecture Findings

- Worker claim flows in the Postgres repository are not atomic. They perform multi-step read-then-save flows without transaction-level locking, so concurrent claim requests can select the same job before either save wins.
- `recording_jobs` stores transcript and summary artifacts inline as JSONB and the operator jobs API returns them in the list response. The frontend polls this endpoint every 5 seconds and renders full transcript text in the dashboard.
- The operator jobs API does two `listBySubmitter` calls and then one `listByJob` call per job, creating an N+1 query pattern on every poll.
- The Postgres repositories define tables but no indexes were found in the repository layer, despite frequent lookups by `submitter_id`, `quota_day_key`, `state`, and `processing_stage`.
- Upload handling buffers files in memory with a 250 MB limit per request before sending to object storage.
- Summary generation runs synchronously inside the transcription worker after transcript upload. A worker waits for summary capacity and then performs summary work itself instead of returning to claim the next transcript job.
- Transcript completion marks the job `completed` before summary generation begins. This can release reserved cloud quota early and exposes delete/export actions while summary is still pending.
- Operator history deletion removes DB rows only. There is no corresponding artifact deletion interface for uploaded audio, recordings, transcripts, or summaries.
- Internal worker and meeting-bot ingestion routes are exposed on the public control-plane app without route-level authentication.

## Verification

- Ran `npm test` successfully.
- Node tests: 4 files / 8 tests passed.
- Python tests: 30 tests passed.

## OpenSpec Context

- `openspec list` shows multiple active changes, including unfinished work around authenticated archive and autonomous meeting recording.
- `openspec list --specs` returns no specs, so the project currently has pending change proposals but no published capability specs to anchor "current truth".
- For a company-scale hardening effort, formalizing a proposal first would fit the repository's intended process.

## Proposal Created

- Added OpenSpec change `refactor-company-scale-runtime`.
- The proposal is intentionally phased into:
- must-fix items required before treating the runtime as 100-user ready
- should-fix items for the next hardening wave
- can-defer items after rollout safety is established
- `openspec validate refactor-company-scale-runtime --strict --no-interactive` passed.

## Proposal Gaps Closed

- The original runtime-hardening proposal described technical fixes but did not yet define what a "100-person company ready" claim actually means in workload terms.
- The change now includes a dedicated `deployment-readiness` spec delta so any future 100-user readiness claim must declare its rollout profile, required topology, and repeatable load/recovery verification steps.
- The change now also requires explicit backlog policy and operator-visible capacity-waiting states, because hidden queueing is a practical failure mode for the current single-slot live-meeting and low-concurrency transcription design.

## Implementation Progress

- Implemented the first runtime-hardening slice for live meeting admission control.
- Meeting submissions now enforce a configurable `MAX_MEETING_JOB_BACKLOG` limit instead of allowing unbounded hidden queue growth.
- When the shared meeting-bot capacity is busy or another meeting is already queued ahead, new meeting jobs remain `queued` but now carry an explicit `waiting-for-recording-capacity` stage and message.
- Claiming a meeting job now clears that waiting stage and moves the job into an explicit `joining-meeting` stage.
- The control-plane Postgres repository tests also exposed two pre-existing SQL issues during full-suite verification: a placeholder mismatch in `save()` and pg-mem-incompatible outer-table references in claim queries. Both were corrected while validating this slice.
- Implemented the next lease-safety slice for stale worker callbacks.
- Callbacks that include a superseded lease token now no-op instead of mutating the job after that lease has been released or replaced.
- Added regression coverage for wrong-token summary callbacks and stale recording callbacks that arrive after the recording lease has already been released.
- Implemented the next archive hot-path slice for paginated operator history.
- Paginated archive repository reads now return lightweight rows with transcript/summary previews and presence flags instead of hydrating full transcript, summary, and history payloads for every poll.
- Full transcript and summary bodies remain available on detail and export paths, so the operator UX keeps the list/detail split without reintroducing hot-path payload bloat.
- Implemented the next storage/query hardening slice for Postgres access paths.
- `recording_jobs` now has explicit indexes for submitter archive pagination, active submitter checks, meeting queue scans, transcription claim scans, summary claim scans, and summary-active scans instead of relying on heap scans.
- `cloud_usage_ledger` now has explicit indexes for job history reads and quota-day reporting rather than depending only on the primary key and implicit uniqueness on fresh tables.
- Added paginated operator archive list responses with cursor-based navigation, aggregate counts, batched actual-cost summaries, and a dashboard-side "load more" flow.
- Added a configurable `MAX_TRANSCRIPTION_JOB_BACKLOG` guard so uploaded jobs stop creating an unbounded transcription wait queue.
- Added a repeatable load probe script at `scripts/run_runtime_load_probe.mjs` and linked it from the rollout checklist.

## Verification Pass Findings

- A fresh full-suite run surfaced real regressions in the lease-heartbeat contract rather than random test drift.
- The control-plane had repository heartbeat support but no corresponding `/recording-jobs/:id/leases/heartbeat` route, so worker heartbeats could not reach the server.
- Worker claim responses were not exposing generic `leaseAcquiredAt`, `leaseHeartbeatAt`, and `leaseExpiresAt` fields even though tests and worker contracts expected them.
- The recording worker had heartbeat expectations in tests but no runtime heartbeat loop or HTTP client method.
- The transcription and summary workers likewise had heartbeat tests but neither worker loop accepted `heartbeat_interval_ms` nor posted lease heartbeats through the control-plane client.
- The stale transcription reclaim heuristic still relied on `updatedAt` even when lease heartbeat and expiry metadata existed, which made the liveness contract weaker than the persisted schema implied.
- After implementing the missing heartbeat route/client/loop behavior and generic lease field mapping, the full project test and build commands passed.

## Compose Smoke Findings

- A live docker-compose smoke is now practical without a real meeting bot by using `docker-compose.smoke.yml`, a MinIO bucket-init job, and a stub artifact server that lets meeting-link jobs drive the downstream runtime.
- The first smoke run showed that persisted Postgres policy rows can override the intended local smoke defaults even when container environment variables are correct; for reliable smoke results, the runtime policy store must start clean or be explicitly reset.
- The synthetic smoke asset can produce empty transcript segments while the runtime path still behaves correctly end to end. For this smoke, the useful pass/fail boundary is successful completion plus transcript artifact creation, summary artifact creation, operator list/detail visibility, and export success.

## Runtime Health Findings

- The existing admin/auth surface was already a good fit for privileged runtime observability; adding runtime health to the dedicated admin page avoided leaking system-wide queue or lease signals onto the ordinary operator dashboard.
- Current repository contracts could already provide meeting and transcription backlog depth plus active-processing rows, but summary backlog needed its own explicit `countPendingSummaryJobs()` path to make saturation visible.
- A useful first runtime-health payload can be built from durable job rows without adding a separate metrics store yet: queue depth comes from repository counts, lease age comes from persisted heartbeat metadata, and latency/throughput/failure summaries can be derived from the current quota-day job set.
- Artifact cleanup still has no implemented policy or backlog source, so the new runtime-health surface reports that cleanup policy is not yet enabled rather than pretending object cleanup is operational.

## Dashboard Auth Findings

- The dashboard already had a full email/OTP auth panel, but the topbar gave no clear CTA when the operator was unauthenticated, which made the login path easy to miss.
- In the current local workspace, `.env` is missing both `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`; that causes `/api/auth/config` to return auth-disabled and explains why the page previously fell back to visitor mode.
- The safer UX is to keep a visible login card in the topbar even when auth is disabled, but mark it as unavailable and explain that environment setup is missing rather than hiding the login path entirely.

## Meeting Platform Verification Findings

- The repository can self-verify platform support only up to the browser-bot integration boundary: supported link matching, ScreenApp endpoint dispatch, lobby/error callback handling, completion webhook mapping, transcript generation, and summary generation are all locally testable.
- Real Google Meet, Microsoft Teams, and Zoom recording validation still depends on upstream host-controlled settings that the repo cannot assert by itself, such as Google Meet access controls, Teams lobby admission policy, and Zoom browser-join plus waiting-room configuration.
- Zoom direct `/j/<meeting-id>` links with embedded `pwd=` and `omn=` parameters are now accepted locally, so the remaining Zoom constraint is the upstream platform's browser-join and waiting-room policy rather than a control-plane rejection.
- Because of that boundary, a truthful readiness claim needs two layers:
- local self-verification proving the repo's join-dispatch and callback pipeline
- real meeting acceptance runs proving the upstream platform will actually admit the bot and produce a recording artifact
- A live Google Meet test on 2026-04-13 proved the local Google path is not blocked at dispatch time: the bot launched a browser, navigated to the real Meet URL, filled the guest name, clicked `Ask to join`, and then entered repeated lobby wait timeouts.
- That same run also proved the current upstream Google Meet settings were not sufficient for unattended recording: neither a browser guest nor the bot were admitted, and no recording artifact was produced.
- Microsoft Teams can likely be pushed to a real external test from this machine only if a Microsoft account is available to complete the `teams.live.com/free/` host flow; the free Teams page is reachable, but host creation redirects to Microsoft sign-in.
- Zoom can likely be pushed to a real external test from this machine only if a Zoom account is available to host a browser-join-compatible meeting; the public Zoom entry point reaches sign-in immediately and does not provide a hostable meeting path anonymously.
- Summary smoke exposed a second repo-owned blocker: the local Codex summary path defaults to models that are not reliably available in this environment (`gpt-5-mini` unsupported, `gpt-5.3-codex-spark` quota-limited), and the summarizer currently reports the generic stderr warning instead of the structured Codex stdout error.
- Zoom end-to-end smoke with an embedded-passcode join URL now completes successfully: recording, transcript, summary, operator list/detail, and export all passed in the live docker-compose smoke stack.
- Google Meet local smoke also completes successfully after the summary fixes; both upload and meeting-link jobs reached completed with recording/transcript/summary artifacts.
- Microsoft Teams local smoke also completes successfully after the summary fixes; the local stack now proves meeting-link jobs for Meet/Teams/Zoom all reach completed with recording/transcript/summary artifacts when the platform itself hands back a recording artifact.
- There was still one repo-owned Zoom URL gap after the first round of fixes: direct Zoom web-client links under `.../wc/join/<meeting-id>` were rejected by control-plane policy even though the upstream ScreenApp `ZoomBot` can navigate them.
- After adding a RED test and widening policy matching, the control-plane now accepts both standard Zoom invite links (`/j/<id>`) and direct Zoom web-client links (`/wc/join/<id>`).
- The next repo-owned correctness gap was not the join click itself but the absence of durable evidence that the click actually turned into a lobby / waiting-room join request; previously the system only knew success after admission or failure after timeout.
- The control-plane now accepts `JoinRequest.Submitted` info logs from the meeting bot and persists them as `processingStage=waiting-for-host-admission`, which makes “the bot really submitted the join request and is waiting for approval” visible in the job state.
- Google Meet, Microsoft Teams, and Zoom overlays now use a shared body-text evidence helper to report that signal only after seeing waiting-room/lobby copy, instead of treating a raw button click as proof of submission.
- A real Google Meet run against `https://meet.google.com/uug-rfdf-umn` proved the bot can reach the guest pre-join page, fill the guest name, click `Ask to join`, get admitted, and begin recording in the upstream meeting.
- That same live run showed why `waiting-for-host-admission` can still be missed in practice: the currently running meeting-bot container only checks lobby evidence on a coarse cadence, so a fast host admission can move directly from the clicked join action into the in-call UI before a waiting-room progress callback is emitted.
- A container-local Playwright pre-check against the same Meet link surfaced the English denial copy `You can't join this video call / No one can join a meeting unless invited or admitted by the host`, so Google denial detection cannot rely on Chinese-only refusal text.
- The live screenapp stack had a separate downstream blocker unrelated to meeting admission: `transcription-worker` was crash-looping on a broken cached `large-v3` Whisper snapshot missing `model.bin`; reverting the live runtime to `WHISPER_MODEL=tiny` avoids that broken cache and matches the current jobs' `transcriptionModel`.
- A live Microsoft Teams run against `https://teams.live.com/meet/9338426661233?p=dotKQWNa6OyMwI4xyg` proved the bot can navigate the Teams web join flow (pre-warm → Join from browser → fill name → disable camera/mic → Join now), enter the meeting, and record via ffmpeg x11grab + PulseAudio.
- The first Teams graceful-shutdown attempt exposed a scoping bug in `MicrosoftTeamsBot.js`: `const handleStopSignal` was declared inside the `try` block but referenced in the `finally` block; since `const` is block-scoped, the `finally` block threw `ReferenceError: handleStopSignal is not defined`, which prevented ffmpeg finalization and S3 upload. Hoisting the declaration before the `try` block fixed the issue.
- After the fix, a second Teams run completed the full end-to-end pipeline: 106 s recording → ffmpeg graceful quit (code 0) → 7.99 MB S3 upload (42 ms) → webhook → transcription (Whisper tiny) → Codex summary → `state=completed`.
