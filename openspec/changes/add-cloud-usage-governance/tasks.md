## 1. Schema & Domain
- [x] 1.1 Introduce a broader AI processing policy settings model for transcription route, summary route, pricing version, quota defaults, and concurrency pool limits.
- [x] 1.2 Extend recording job persistence with submission-time policy snapshot and quota reservation fields.
- [x] 1.3 Add persistent tables for per-user cloud quota overrides, append-only cloud usage ledger entries, and append-only admin audit log entries.

## 2. Control-Plane Governance Services
- [x] 2.1 Add a policy resolution service that snapshots the effective AI policy and pricing version onto each new job at submission time.
- [x] 2.2 Add daily cloud quota estimation, reservation, rejection, and settlement logic for uploaded-media and meeting-link jobs.
- [x] 2.3 Add admin APIs for reading and updating default routing, model settings, quota defaults, concurrency pools, and per-user quota overrides.
- [x] 2.4 Add admin audit log writes for every policy, quota, and override mutation.

## 3. Worker & Pipeline Updates
- [x] 3.1 Update transcription worker claim payloads and execution flow to use the job snapshot instead of claim-time global defaults.
- [x] 3.2 Support independent summary provider routing and model selection from the job snapshot.
- [x] 3.3 Record actual cloud usage ledger entries for transcription and summary stages and trigger quota settlement when actual cost is known.
- [x] 3.4 Respect stage-specific local/cloud concurrency pools when scheduling work.

## 4. Dashboard
- [x] 4.1 Extend the admin dashboard with AI routing, quota, concurrency, and per-user override controls.
- [x] 4.2 Add an admin audit history view for recent governance changes.
- [x] 4.3 Show ordinary operators their remaining daily cloud quota and clear quota rejection feedback during submission.

## 5. Verification & Docs
- [x] 5.1 Add or update automated tests for policy snapshotting, quota reservation, usage settlement, provider split, concurrency pools, admin APIs, and dashboard behavior.
- [x] 5.2 Update runtime and operator documentation for cloud governance behavior, assumptions, and non-goals.
- [x] 5.3 Validate the OpenSpec change with `openspec validate add-cloud-usage-governance --strict --no-interactive`.
