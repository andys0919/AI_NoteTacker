## Context

The current runtime exposes two separate admin controls:
- a global transcription provider switch
- a global summary model string

That design is intentionally small, but it is no longer sufficient for shared internal usage. The system must answer five governance questions that it cannot answer today:
- What exact cloud policy did a job use when it was submitted?
- How much cloud spend did transcription cost for this job?
- How much cloud spend did summary generation cost for this job?
- How much cloud budget does a user still have today?
- Who changed the policy or quota that affected later jobs?

The proposal keeps the deployment model intentionally simple:
- single company
- one authenticated user namespace
- admin authorization continues to use the existing allowlist approach
- cloud governance applies only to external billable spend
- local execution remains supported but does not create billable cloud usage entries

## Goals / Non-Goals

**Goals**
- Make cloud-routed jobs deterministic by snapshotting the effective AI policy at submission time.
- Track actual cloud usage and USD cost separately for transcription and summary stages.
- Enforce a per-user daily cloud budget with reservation before work starts and settlement after work completes.
- Support independent routing for transcription and summary across local and cloud providers.
- Split concurrency gates so cloud-routed work does not unnecessarily block local-routed work, and vice versa.
- Give admins a practical internal governance UI plus an audit trail.

**Non-Goals**
- No local cost accounting.
- No department budgets, cost centers, or multi-tenant billing.
- No generalized RBAC system beyond the existing authenticated operator plus admin allowlist model.
- No direct browser editing of secrets or raw Azure credentials.
- No invoice reconciliation against external provider billing exports in this slice.

## Decisions

### 1. Snapshot cloud-governed policy at submission time

The system will create a job policy snapshot when an operator submits a meeting-link job or upload job. The snapshot will carry the effective cloud-governed policy fields needed for deterministic execution and cost control:
- transcription provider
- transcription model identifier
- summary provider
- summary model identifier
- pricing catalog version
- quota reservation estimate
- quota day key used for budget accounting

Queued jobs will no longer inherit later admin routing changes. A later policy change affects only jobs submitted after the change.

### 2. Use reservation plus settlement for quota accounting

Cloud quota must be decided before execution begins, but actual cost is only known after execution. The system will therefore:
- estimate cloud cost at submission time
- reserve that amount against the operator's daily cloud quota
- record actual billable usage after transcription and summary finish
- settle the difference by releasing unused reservation or consuming additional budget

This applies to both uploaded-media and meeting-link jobs. Because meeting-link duration is unknown at submission time, the estimate will use an admin-managed default cloud reservation cap for live meeting jobs.

### 3. Separate transcription routing from summary routing

Transcription and summary are distinct billable stages with different cost and privacy characteristics. The governance model will therefore keep independent defaults and job snapshot fields for:
- transcription provider and model
- summary provider and model

That allows supported combinations such as:
- local transcription + cloud summary
- cloud transcription + local summary
- local transcription + local summary
- cloud transcription + cloud summary

The system will not silently fail over between providers. The job snapshot remains authoritative for that job.

### 4. Introduce an explicit cloud usage ledger

The product needs an append-only source of truth for cloud spend. A new cloud usage ledger will record one or more entries per job stage. Each entry will include:
- job id
- submitter id
- stage (`transcription` or `summary`)
- provider
- model identifier
- pricing version
- measured usage quantity
- usage unit
- billable USD amount
- estimate vs actual marker
- timestamp and correlation metadata

For summary, cost will come from provider token usage when available. For transcription, cost will come from actual processed audio duration or equivalent provider billing quantity when direct provider usage metadata is absent.

### 5. Replace the singleton settings shape with a broader AI policy settings model

The current `transcription_provider_settings` table name is too narrow for the new responsibility set. This change should introduce a broader policy store such as `ai_processing_policy_settings` rather than continue extending a misleading schema. Existing values for transcription provider and summary model will be migrated into the new structure during rollout.

### 6. Keep authorization small and auditable

This proposal does not add full RBAC. Admin-only governance endpoints will continue using authenticated operator identity plus the configured admin email allowlist. The missing governance layer is auditability, not a new role system. Every admin policy or quota change will therefore append an audit log entry with actor, timestamp, old value, and new value.

### 7. Use provider- and stage-specific concurrency pools

The current worker claim path uses one shared transcription concurrency gate. That is too coarse once transcription and summary can route independently to cloud or local execution. The new policy will define separate pool sizes for:
- local transcription
- cloud transcription
- local summary
- cloud summary

The claim and execution flow will respect the pool that matches the job snapshot and the stage currently being processed.

## Data Model Shape

### Job snapshot fields

Persist on each job:
- `transcription_provider`
- `transcription_model`
- `summary_provider`
- `summary_model`
- `pricing_version`
- `estimated_cloud_reservation_usd`
- `reserved_cloud_quota_usd`
- `quota_day_key`

### New tables

- `ai_processing_policy_settings`
- singleton settings for default routing, model identifiers, pricing version, live meeting reservation cap, and concurrency pool limits

- `operator_cloud_quota_overrides`
- optional per-user daily quota override values

- `cloud_usage_ledger`
- append-only estimate and actual usage entries for transcription and summary stages

- `admin_audit_log`
- append-only audit trail for admin changes

### Derived reporting

The daily budget view should be computed from:
- default quota or per-user override
- reserved estimate totals
- settled actual totals
- quota day key

## Data Flow

1. Operator submits a job.
2. Control-plane resolves the current default AI policy plus any per-user quota override.
3. Control-plane estimates cloud cost for the requested job shape.
4. If the estimate exceeds the operator's remaining daily cloud budget, submission is rejected.
5. Otherwise the job is created with a policy snapshot and reserved quota amount.
6. Worker claim returns the job snapshot rather than the current global policy.
7. Execution runs according to the snapshot.
8. After transcription and summary complete, each cloud-routed stage writes actual usage ledger entries.
9. Quota settlement reconciles estimate vs actual and updates remaining daily budget.
10. Admin changes later policy or quota values; those changes are audited and affect only later submissions.

## Risks / Trade-offs

- [Meeting-link estimates can be wrong] -> mitigated with an explicit admin-managed live meeting reservation cap and post-run settlement.
- [Summary cost estimation may be approximate before transcript exists] -> mitigated by reserving conservatively and settling against actual token usage.
- [The current single settings table becomes obsolete] -> mitigated with an explicit migration to a broader policy table.
- [No RBAC beyond admin allowlist] -> acceptable for the internal single-company slice because audit logging is more urgent than a full role model.
- [Concurrency pools add scheduling complexity] -> justified because a single global concurrency counter causes avoidable blocking once routing splits by stage and provider.

## Migration Plan

1. Introduce the new AI policy settings schema alongside the current singleton settings store.
2. Backfill the current transcription provider and summary model into the new settings structure.
3. Add new nullable snapshot fields to jobs and populate them for all newly submitted jobs.
4. Add quota, usage ledger, and audit tables.
5. Update admin APIs and dashboard to read from the new policy store.
6. Update worker claim payloads and execution flow to use the job snapshot.
7. Remove reliance on claim-time global routing selection after verification.

## Open Questions

- Whether quota day reset should be driven by a dedicated company timezone setting or by the runtime timezone.
- Whether admin UI should expose only current values and recent audit history in the first slice, or also include a searchable usage report view.
