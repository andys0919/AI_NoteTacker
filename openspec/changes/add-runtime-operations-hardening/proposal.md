# Change: Add Runtime Operations Hardening

## Why
The initial 100-user rollout hardening work is now archived into the published specs, but the runtime still lacks the operational layer needed to run and evolve that deployment safely over time. The most important missing pieces are explicit heartbeat metadata for active leases, policy-aligned artifact cleanup, durable runtime health signals, and clear guidance for moving from a single fixed-capacity deployment toward replica-safe or autoscaled topologies.

Without that work, the current runtime can process jobs correctly under the declared rollout profile, but it is still too opaque and too manual for ongoing operations. Maintainers would have to infer worker liveness from lease expiry alone, delete archive rows without knowing whether object cleanup happened, and scale the topology without a documented contract for upgrades or saturation-driven capacity changes.

## What Changes
- add explicit per-stage heartbeat metadata and lease-age visibility on top of the existing atomic lease model
- define artifact lifecycle and retention behavior for uploaded media, recordings, transcripts, and summaries
- align operator delete and clear-history actions with object cleanup or retention policy instead of metadata-only deletion
- add durable runtime health metrics and machine-readable reporting for queue depth, lease churn, stage latency, throughput, failure rates, and capacity saturation
- add a privileged runtime health dashboard surface without exposing system-wide data to ordinary operators
- extend deployment readiness guidance with replica-safe multi-instance deployment, rolling-upgrade procedures, and capacity-evolution guidance beyond the first fixed-capacity profile

## Impact
- Affected specs: `job-progress-tracking`, `deployment-readiness`, `operator-dashboard`, `artifact-lifecycle`, `runtime-observability`
- Affected code: control-plane lease persistence and reclaim logic, worker heartbeat reporting, object-storage cleanup paths, operator/admin runtime APIs, dashboard admin views, deployment docs and operational runbooks
