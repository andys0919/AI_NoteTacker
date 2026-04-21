## 1. Implementation
- [x] 1.1 Add failing tests for explicit stage heartbeats, lease-age visibility, and heartbeat-aware stale-lease reclaim.
- [ ] 1.2 Add failing tests for artifact lifecycle behavior on single-job delete, clear-history, and retention-driven cleanup.
- [x] 1.3 Add failing tests for runtime health aggregation, privileged dashboard/runtime API access, and ordinary-operator isolation.
- [x] 1.4 Persist explicit heartbeat metadata for active stage leases and use it in reclaim decisions.
- [ ] 1.5 Implement artifact lifecycle policy and cleanup handling for uploaded media, recordings, transcripts, and summaries.
- [x] 1.6 Add runtime health metrics, reporting endpoints, and privileged dashboard views for queue, lease, latency, throughput, failure, and saturation signals.
- [ ] 1.7 Publish multi-instance rollout, rolling-upgrade, and capacity-evolution guidance for the next deployment profile.

## 2. Verification
- [ ] 2.1 Verify targeted control-plane and worker tests for heartbeat, cleanup, and runtime health behavior.
- [x] 2.2 Verify relevant dashboard tests or smoke checks for privileged runtime health visibility and role isolation.
- [x] 2.3 Validate the OpenSpec change with `openspec validate add-runtime-operations-hardening --strict --no-interactive`.
