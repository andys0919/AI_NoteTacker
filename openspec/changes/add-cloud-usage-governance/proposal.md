# Change: Add Cloud Usage Governance

## Why
The product can already switch future transcription jobs between local Whisper and Azure OpenAI, and it can already change the summary model for future jobs. That is enough for a small admin-operated setup, but it is not enough for a single-company shared deployment where many employees may submit jobs on the same day.

The current system has no cloud usage ledger, no per-user daily quota, no quota reservation, no admin audit trail for governance changes, and no way to route transcription and summary independently. It also resolves provider settings too late: queued jobs inherit the current global setting only when a worker claims them. That makes cost governance ambiguous because a queued job can change behavior after submission if an admin flips the global setting.

This change adds the minimum governance layer needed for a practical internal company deployment while intentionally keeping scope limited to cloud spend only. Local execution cost accounting remains out of scope.

## What Changes
- Add a submission-time AI job policy snapshot that locks the effective transcription route, summary route, model identifiers, pricing version, and estimated cloud reservation onto each job.
- Add a cloud usage ledger that records billable transcription and summary usage separately per job and per stage.
- Add per-user daily cloud quota reservation and settlement for submitted jobs.
- Let admins configure separate defaults for:
- transcription provider and model
- summary provider and model
- local and cloud concurrency pools by stage
- default daily cloud quota and optional per-user quota overrides
- pricing catalog version used for cloud cost calculation
- Let transcription and summary route independently between cloud and local execution.
- Add admin audit logging for policy changes, quota changes, and manual overrides.
- Extend the operator dashboard with quota visibility and extend the admin dashboard with governance controls.

## Impact
- Affected specs:
- `job-execution-policy`
- `cloud-usage-governance`
- `transcription-provider-management`
- `whisper-transcription-pipeline`
- `meeting-summary-generation`
- `operator-dashboard`
- Affected code:
- control-plane settings storage, quota service, usage ledger service, claim flow, and admin APIs
- recording job schema and repositories
- transcription worker claim contract and stage reporting
- admin and operator dashboard views
- documentation and tests
