## 1. Contract

- [x] 1.1 Add and strictly validate the quota-only fallback change.
- [x] 1.2 Align the local-summary change, project, README, worker, and handoff contracts.

## 2. Worker

- [x] 2.1 Add a bounded structured Codex rate-limit probe with fail-closed classification.
- [x] 2.2 Reuse the Azure Responses summarizer as a single-call fallback only for explicit Codex exhaustion.
- [x] 2.3 Keep OAuth/service/Azure credentials outside transcript input, browser state, logs, and the Codex child environment.

## 3. Usage settlement

- [x] 3.1 Report and validate the actual summary provider on terminal callbacks.
- [x] 3.2 Atomically reserve one Azure fallback per job and settle terminally reported success or failure under the active summary lease without relabeling Local Codex work.
- [x] 3.3 Bind the reservation to the first Azure request ID, reject mixed-provider terminal audits, and omit phantom usage when failure occurs before provider contact.

## 4. Verification and rollout

- [x] 4.1 Run targeted worker, control-plane, build, Compose, and strict OpenSpec checks.
- [x] 4.2 Review standards/spec compliance and fix material findings.
- [x] 4.3 Deploy the canonical production stack and verify Local Codex remains the live default without forcing a paid fallback call.
- [x] 4.4 Redeploy the post-review request-binding migration and reverify live schema/runtime without forcing a paid fallback call.
