## Context

The published runtime specs now cover the initial 100-user rollout contract:
- atomic stage claims
- explicit backlog policy
- lightweight archive polling
- stage-aware completion semantics
- private internal routes
- rollout-profile verification

That is enough to make the first rollout claim concrete, but it is not enough to make the runtime easy to operate. Day-2 operations still have weak spots:
- worker liveness is inferred mostly from lease expiry rather than explicit heartbeats
- archive deletion semantics do not yet say what happens to stored objects
- runtime health requires piecing together logs and job rows instead of reading stable metrics
- the next scaling step past the first fixed-capacity deployment is not documented as a repeatable contract

## Goals / Non-Goals

**Goals**
- Make active lease health observable before a lease actually expires.
- Define what artifact deletion, retention, and cleanup mean operationally.
- Expose runtime health in durable metrics and privileged reporting surfaces.
- Document how to evolve from the initial rollout profile toward larger or replicated deployments.

**Non-Goals**
- No new end-user transcription or summary features.
- No redesign of the initial rollout profile itself.
- No requirement to implement full autoscaling in this slice.
- No requirement to expose system-wide runtime health to ordinary operators.

## Decisions

### 1. Make heartbeats first-class lease metadata

Atomic claims already prevent duplicate ownership, but long-running work still needs explicit liveness tracking. This change will require:
- durable heartbeat timestamps for active stage leases
- reclaim thresholds based on missed heartbeats rather than generic row freshness
- lease-age visibility for privileged runtime-health reporting

Lease expiry remains the safety boundary, but heartbeat data becomes the normal operational signal.

### 2. Separate archive visibility from artifact retention

Operator delete and clear-history actions should stop meaning only "remove the row from the visible list." The runtime needs an explicit lifecycle policy for:
- uploaded source media
- meeting recordings
- transcript artifacts
- summary artifacts

The policy may allow immediate deletion, delayed expiry, or retained artifacts with hidden dashboard visibility, but the behavior must be explicit and auditable.

### 3. Standardize runtime health signals

Operations should not depend on ad hoc SQL or log scraping. This change will define a stable reporting surface for:
- queue depth by scarce pool
- lease age and lease churn
- stage latency
- upload throughput
- terminal failure counts
- capacity saturation and cleanup backlog

These signals should support both human dashboards and machine-readable alerting.

### 4. Treat larger topology guidance as a readiness contract

Moving beyond the initial fixed-capacity rollout is an architectural step, not an implementation accident. The project should therefore document:
- when a deployment should add replicas or higher fixed capacity
- what configuration must remain shared or replica-safe
- how rolling upgrades avoid duplicate work or public-route regressions
- when autoscaling is justified instead of more manual capacity increases

## Risks / Trade-offs

- [Heartbeat metadata adds write volume to active jobs] -> acceptable because explicit liveness is operationally more valuable than inferring staleness after the fact.
- [Artifact cleanup rules may surface policy disagreements] -> acceptable because hidden deletion semantics are worse than explicit trade-offs.
- [Runtime health surfaces add admin/dashboard complexity] -> acceptable because the current system lacks a stable way to observe queue and lease health.
- [Multi-instance guidance may outpace current deployment defaults] -> acceptable because the change is about documenting the contract for the next rollout step, not forcing replica deployment immediately.

## Migration Plan

1. Extend specs to define heartbeat metadata, runtime observability, artifact lifecycle, and next-profile deployment guidance.
2. Add lease heartbeat persistence and reclaim semantics in the control-plane and worker contracts.
3. Add artifact lifecycle metadata and cleanup execution paths for delete and retention policies.
4. Add runtime health aggregation APIs and privileged dashboard surfaces.
5. Publish multi-instance and rolling-upgrade guidance tied to the rollout-readiness spec.
