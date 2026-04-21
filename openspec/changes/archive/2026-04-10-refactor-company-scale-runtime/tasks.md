## 1. Must Fix Before 100-User Rollout
- [x] 1.1 Define the initial 100-user rollout profile: peak concurrent live meetings, uploaded transcriptions, summary load, retention assumptions, and acceptable queue delay.
- [x] 1.2 Publish the minimum deployment topology and resource envelope required for that rollout profile.
- [x] 1.3 Enforce configured concurrency and backlog limits for live-meeting capture and other scarce processing pools, with explicit waiting states and overload rejection once queue caps are reached.
- [x] 1.4 Replace read-then-save worker claims with atomic lease-based claim semantics for recording, transcription, and summary stages.
- [x] 1.5 Split summary generation into independently claimable work so transcription workers release capacity immediately after transcript persistence.
- [x] 1.6 Update job lifecycle semantics so a job is not marked `completed` until every configured stage is terminal and visible to operators.
- [x] 1.7 Add idempotent worker callback handling for transcript, summary, failure, and usage-settlement events.
- [x] 1.8 Protect worker claim routes, worker event routes, and meeting-bot callbacks with internal service authentication and private deployment guidance.
- [x] 1.9 Replace buffered control-plane uploads with streaming or direct-to-object-storage uploaded-media ingestion.
- [x] 1.10 Replace the heavyweight operator jobs hot path with a paginated lightweight archive list plus separate per-job detail retrieval.
- [x] 1.11 Keep quota reservations held until all configured billable stages settle and prevent duplicate actual-usage writes on retry.

## 2. Additional Runtime Reductions Shipped With This Change
- [x] 2.1 Move transcript bodies, summary bodies, and other large archive payloads off the hot `recording_jobs` retrieval path.
- [x] 2.2 Add the Postgres indexes required for submitter-scoped archive retrieval, stage claiming, quota-day reporting, and summary scheduling.

## 3. Verification
- [x] 3.1 Add concurrency and lease-recovery tests that cover duplicate-claim prevention, stale lease reclaim, and stale callback rejection.
- [x] 3.2 Add API and dashboard tests that verify paginated lightweight lists, capacity-waiting states, and on-demand heavy archive details.
- [x] 3.3 Add upload and mixed-workload bench coverage or repeatable load scripts for large-file bursts, simultaneous stage execution, and backlog saturation.
- [x] 3.4 Add a documented go/no-go checklist for the declared rollout profile, including pass/fail thresholds for correctness, queue drain, and recovery behavior.
- [x] 3.5 Validate the OpenSpec change with `openspec validate refactor-company-scale-runtime --strict --no-interactive`.

## 4. Deferred Follow-On Work
- Explicit per-stage heartbeat metadata and richer lease-churn visibility remain outside this change's shipped scope.
- Artifact retention, object cleanup, and delete-policy alignment remain outside this change's shipped scope.
- Runtime metrics, operational dashboards, autoscaling, multi-instance rollout guidance, and richer archive reporting remain outside this change's shipped scope.
