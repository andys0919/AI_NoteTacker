# Change: Harden Initial Company-Scale Runtime Rollout

## Why
The current product is functional for a small, low-concurrency internal setup, but it is not yet safe to position as a shared company service for roughly 100 employees. The main blockers are not feature gaps. They are correctness, throughput, and security gaps in the runtime model itself.

The current design has a single shared live-meeting runtime, a default single transcription slot, non-atomic worker claim flows, a heavyweight hot-path archive query shape, buffered upload handling in control-plane memory, and unauthenticated internal worker/webhook routes. Those choices are survivable at low volume, but they become operational risks once the product is used as a real internal service with bursts, retries, multiple workers, and longer retention windows.

The current repository also has no explicit definition for what a "100-person company ready" claim actually means. A 100-seat company does not imply 100 simultaneous recordings, but it does require a named rollout profile with declared concurrency assumptions, bounded backlog behavior, and repeatable proof that the chosen deployment can survive the expected peak.

This change defines and delivers the initial hardening slice needed before calling the runtime ready for that first internal rollout profile. Broader scale-out, observability, and archive-operations work remains follow-on work rather than a blocker for this specific change.

## What Changes
- define a named 100-user rollout profile with explicit concurrency assumptions, required topology, and go-live verification gates
- add atomic lease-based claiming for recording, transcription, and summary work, plus stale-callback no-op handling for superseded leases
- enforce configured concurrency and backlog limits for scarce capacity, especially live-meeting capture and uploaded transcription, with explicit waiting states and overload rejection once queue caps are exceeded
- split summary execution into independently claimable work instead of holding transcription workers hostage
- prevent jobs from being marked `completed` before all configured stages are terminal and visible to operators
- replace heavyweight archive polling with thin paginated list APIs plus on-demand detail retrieval and lightweight preview fields
- move large transcript and summary bodies off the hot paginated retrieval path and add the Postgres indexes required for the new claim, pagination, and quota-reporting access paths
- replace buffered upload ingestion with streaming or direct-to-object-storage upload handling
- require internal service authentication and private routing guidance for worker and webhook endpoints
- make cloud usage settlement and reservation release idempotent across retries and aligned with final billable-stage settlement
- add rollout verification artifacts, including the documented go/no-go checklist and repeatable load probe script

## Deferred Follow-On Work
- Add explicit per-stage heartbeat metadata and richer lease-churn visibility beyond the current lease-token and expiry semantics.
- Add artifact retention and object-cleanup behavior that aligns operator deletes and history clearing with stored recordings, uploads, transcripts, and summaries.
- Add runtime metrics and operator/admin dashboards for queue depth, lease age, stage latency, upload throughput, capacity saturation, and failure rates.
- Add multi-instance control-plane rollout guidance, replica-safe configuration, rolling upgrades, and worker autoscaling guidance beyond the initial fixed-capacity profile.
- Add richer archive reporting once the thinner list/detail runtime path has settled.

## Impact
- Affected specs:
- `job-progress-tracking`
- `recording-job-management`
- `meeting-summary-generation`
- `media-ingestion`
- `operator-dashboard`
- `cloud-usage-governance`
- `internal-service-security`
- `deployment-readiness`
- Affected code:
- control-plane claim flows, route auth, API shaping, and quota settlement logic
- recording and transcription worker contracts and execution loops
- upload ingestion path and object storage integration
- Postgres schema and indexing strategy
- operator dashboard polling, list/detail flows, and archive UX
- deployment sizing guidance, admission-control policy, testing, and operational runbooks
