## Context

The current repository has already grown from a proof-of-concept into a shared internal product:
- authenticated operators
- archived transcripts and summaries
- export paths
- cloud usage governance
- meeting-bot stop controls

That makes runtime correctness more important than adding another visible feature. A 100-person internal deployment does not require internet-scale architecture, but it does require the system to survive normal enterprise conditions:
- concurrent uploads
- overlapping retries
- multiple workers
- growing archive history
- internal security boundaries
- predictable cloud cost settlement

The present design falls short in five concrete ways:
- worker claims are not atomic, so horizontal scaling can produce duplicate work
- summary generation occupies the same worker capacity that should be reserved for transcript throughput
- the archive hot path is too heavy for constant polling because list refreshes still fetch full job rows and per-job cost lookups
- upload handling uses in-memory buffering in the control-plane process
- internal worker/webhook routes are not protected as a separate trust boundary
- there is no declared rollout profile, so a "100-person" readiness claim has no explicit concurrency or infrastructure meaning
- scarce worker capacity is mostly implicit today, so overload can become a hidden backlog instead of an explicit capacity state

## Goals / Non-Goals

**Goals**
- Make stage ownership correct under concurrent workers and retries.
- Separate transcript throughput from summary throughput.
- Reduce control-plane, database, and browser load for archive refreshes.
- Bound memory usage during uploaded-media ingestion.
- Protect internal service routes independently from operator-facing auth.
- Keep quota reservation and actual usage settlement consistent even when retries occur.
- Define what the initial 100-user rollout claim actually covers in terms of peak concurrency, retention, and topology.
- Make overload behavior explicit through queue semantics, backlog limits, and operator-visible waiting states.
- Require repeatable load and recovery evidence before calling a rollout profile ready.

**Non-Goals**
- No new customer-facing collaboration features.
- No speaker diarization, CRM integration, or semantic search in this slice.
- No full multi-tenant RBAC redesign.
- No autoscaling orchestration in the first hardening phase.
- No complete storage-engine rewrite beyond what is needed to remove hot-path payload bloat.

## Decisions

### 1. Adopt lease-based stage claims

Every runnable stage will be claimed through an atomic lease mutation rather than a read-then-save flow. For this change, the minimum durable lease model is:
- stage owner
- lease token or version
- lease expiration

The important property is correctness, not a specific SQL spell. `SELECT ... FOR UPDATE SKIP LOCKED`, `UPDATE ... WHERE ... RETURNING`, or an equivalent transactional approach are all acceptable as long as only one worker can own a stage at a time.

Older callbacks from stale workers must be rejected or treated as no-ops once a newer lease has superseded them. Explicit per-stage heartbeat columns and richer lease-churn telemetry are follow-on work once the initial rollout path is stable.

### 2. Split transcript and summary scheduling

Transcript generation and summary generation are separate workloads and must stop sharing one worker's wall-clock time. The refactor will treat summary as an independently claimable stage with its own capacity pool.

That means:
- transcription workers finish transcript persistence and release their stage lease
- summary work becomes queued or claimable separately
- a summary backlog no longer blocks new transcript work from starting

This also fixes a product semantics problem: a job should not appear fully complete just because the transcript exists while summary is still pending or failed.

### 3. Separate list and detail archive APIs

The dashboard currently pays too much per refresh because the hot list path still reads full job rows and then performs extra per-job cost lookups. The refactor will split archive access into:
- a lightweight paginated list endpoint for counters, statuses, timestamps, costs, and brief preview fields
- a detail endpoint for one job's full transcript, summary, and deeper stage history

Polling should hit only the thin list endpoint. Heavy content moves to explicit detail fetch or export flows.

### 4. Replace buffered uploads with streaming ingestion

Uploaded-media ingestion must stop requiring the control-plane to hold full file buffers in memory. The accepted solutions are:
- streaming upload through the control-plane into object storage
- direct browser-to-object-storage upload with a signed initiation flow
- a bounded temp-file flow if direct streaming is unavailable

The invariant is that application heap usage must remain bounded relative to concurrency and not scale linearly with total uploaded file size.

### 5. Introduce an internal service trust boundary

Operator auth and internal service auth are different concerns. Worker claim routes, worker event routes, and meeting-bot callbacks must require internal credentials and should live behind private ingress or trusted-network boundaries.

Operator browser tokens must not be sufficient for those routes. Public exposure of those routes should be treated as deployment misconfiguration.

### 6. Make usage settlement idempotent and stage-aware

Reservation release must align to terminal stage outcomes, not to the first partial success event. If a job snapshot says cloud summary can still happen, quota reservation must remain in effect until summary settles or fails with an explicit no-charge outcome.

Actual usage writes must also be idempotent. Retried transcript or summary callbacks cannot duplicate settled cost.

### 7. Tie readiness claims to a named rollout profile

"100-person company ready" is not a technical requirement by itself. This change therefore treats it as a named rollout profile that must declare:
- expected peak concurrent live-meeting captures
- expected peak concurrent uploaded transcriptions
- expected summary load and retention horizon
- minimum worker, database, and object-storage topology
- acceptable queue delay and recovery expectations

The project can then say whether a deployment is ready for that profile instead of making an ambiguous seat-count claim.

### 8. Add explicit admission control and backlog semantics

Scarce capacity must stop behaving like a hidden implementation detail. The runtime should enforce configured limits for:
- simultaneous live-meeting capture
- queued live-meeting backlog
- transcription concurrency
- summary concurrency

When capacity is temporarily saturated but backlog remains within policy, jobs should enter an explicit waiting state. When backlog policy is exceeded, the system should reject new work clearly instead of creating an unbounded hidden queue.

### 9. Require repeatable rollout verification gates

Production-readiness claims must be backed by repeatable evidence. The rollout profile should include a verification procedure that covers:
- burst uploads
- overlapping live-meeting submissions
- summary backlog pressure
- worker restart or lease-expiry recovery
- queue drain behavior under sustained load

The important outcome is not a single benchmark number. It is evidence that the runtime preserves correctness, exposes overload clearly, and recovers without manual repair.

## Risks / Trade-offs

- [Lease logic is more complex than the current repository methods] -> justified because duplicate claims are a correctness bug, not just a performance issue.
- [Splitting summary into its own scheduler adds another queue path] -> justified because summary latency should not consume transcript throughput.
- [Thin list + detail APIs add frontend complexity] -> acceptable because the current polling path is too expensive to scale with archive growth.
- [Streaming upload paths are more operationally complex than in-memory buffering] -> necessary because bounded memory is a production requirement.
- [Internal route auth and private ingress add deployment steps] -> necessary because these routes mutate job state and can indirectly control worker behavior.
- [Declaring rollout profiles adds documentation and verification overhead] -> necessary because ambiguous seat-count readiness claims are otherwise meaningless.
- [Admission control can reject work that used to queue silently] -> necessary because bounded overload is safer than hidden indefinite backlog.

## Migration Plan

1. Define the initial rollout profile and the explicit capacity/backlog policy that the runtime must enforce.
2. Introduce the new lease metadata and atomic claim behavior behind repository and API changes.
3. Add a distinct summary scheduling path while keeping transcript generation behavior stable.
4. Add admission-control states and overload handling for live-meeting and other scarce worker pools.
5. Add thin archive list and detail endpoints, then migrate the dashboard polling path.
6. Replace buffered upload handling with the selected streaming or direct-upload approach.
7. Add internal service auth and update worker / meeting-bot callers.
8. Add idempotent usage settlement and align quota release with final billable stage outcomes.
9. Backfill the required indexes and rollout-verification artifacts once the hot paths are stable, then treat observability and richer operational guidance as follow-on work.

## Deferred Follow-On Topics

- Whether worker liveness should move from lease-expiry-only semantics to explicit per-stage heartbeat timestamps and lease-renewal dashboards.
- Whether operator delete and clear-history flows should trigger immediate object deletion, retention-window expiry, or a policy-driven combination of both.
- Whether the next rollout profile should prioritize worker autoscaling first or multi-instance control-plane procedures first.
- Whether richer archive reporting should stay in the operator dashboard or move to separate admin/reporting surfaces.
