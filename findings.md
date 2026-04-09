# Findings & Decisions

## Requirements
- Create an OpenSpec proposal rather than implementation.
- Scope cost controls to cloud usage only; ignore local execution cost.
- Cover these areas in one proposal:
- job policy snapshot
- usage ledger
- per-user daily quota and reservation
- separate transcription provider and summary provider selection
- concurrency pool split
- admin quota UI and audit log

## Research Findings
- Existing admin controls only persist one global transcription provider and one summary model in a singleton settings table.
- Current transcription provider is latched at claim time, not job creation time.
- Current summary path has only model override support; it does not support a separate persisted summary provider.
- Current worker concurrency gate is one global `MAX_CONCURRENT_TRANSCRIPTION_JOBS` limit, not provider-specific pools.
- There is no current billing, usage, quota, tenant, role, or audit schema in the codebase.
- OpenSpec accepted a proposal that introduces two new capabilities, `job-execution-policy` and `cloud-usage-governance`, plus modifications to existing routing, pipeline, summary, and dashboard capabilities.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Use a new umbrella change-id for cloud governance | The requested work spans data, API, worker behavior, and admin UI |
| Add a new governance capability spec instead of overloading only provider-management specs | Usage ledger, quota reservation, and audit log are distinct from provider selection alone |
| Keep authorization on the current admin allowlist model in the proposal | The user asked for the most pragmatic single-company internal route, not a full RBAC redesign |
| Snapshot policy at submission time instead of claim time | Quota reservation and deterministic cost attribution require stable job policy before workers start |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| Two MODIFIED requirements failed OpenSpec parsing because they lacked standalone requirement text | Rewrote the requirement headers and validated again |

## Resources
- `/home/solomon/Andy/AI_NoteTacker/openspec/AGENTS.md`
- `/home/solomon/Andy/AI_NoteTacker/openspec/project.md`
- `/home/solomon/Andy/AI_NoteTacker/apps/control-plane/src/app.ts`
- `/home/solomon/Andy/AI_NoteTacker/apps/control-plane/src/infrastructure/postgres/postgres-recording-job-repository.ts`
- `/home/solomon/Andy/AI_NoteTacker/apps/control-plane/src/infrastructure/postgres/postgres-transcription-provider-settings-repository.ts`
- `/home/solomon/Andy/AI_NoteTacker/workers/transcription-worker/src/transcription_worker/main.py`
- `/home/solomon/Andy/AI_NoteTacker/workers/transcription-worker/src/transcription_worker/worker_loop.py`
- `/home/solomon/Andy/AI_NoteTacker/openspec/changes/add-cloud-usage-governance/proposal.md`
- `/home/solomon/Andy/AI_NoteTacker/openspec/changes/add-cloud-usage-governance/design.md`
- `/home/solomon/Andy/AI_NoteTacker/openspec/changes/add-cloud-usage-governance/tasks.md`

## Visual/Browser Findings
- Not applicable for this proposal task.
