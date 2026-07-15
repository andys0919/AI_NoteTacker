# Task Plan: Review Azure Responses Handoff

## Goal
Fully review `HANDOFF.md` against the current OpenSpec change, architecture, code,
tests, configuration, and live-execution path; fix proven in-scope defects; update
all relevant Markdown so the documented status and remaining work are truthful.

## Current Phase
Complete

## Phases

### Phase 1: Requirements & Discovery
- [x] Read OpenSpec project context, active changes, relevant published specs, and change artifacts
- [x] Inspect git state, caller/export/shared-utility path, configuration, and tests
- [x] Derive a requirement-to-evidence checklist from `HANDOFF.md` and OpenSpec
- [x] Record authoritative findings in `findings.md`
- **Status:** complete

### Phase 2: Parallel Review
- [x] Review architecture and module boundaries
- [x] Review implementation and failure behavior
- [x] Review tests, config, OpenSpec, and documentation coherence
- [x] Reconcile independent findings against current files
- **Status:** complete

### Phase 3: Correctness & Documentation Updates
- [x] Present correction approaches and obtain design/pricing approval
- [x] Add failing regression checks first for the worker/config/deployment defects
- [x] Apply only the minimal approved/in-scope fixes
- [x] Update OpenSpec artifacts and related Markdown to match verified reality
- [x] Keep task checkboxes and handoff claims synchronized with evidence
- [x] Close final-audit lease provenance/race, structured-summary, timeout, and pricing-validation defects
- [x] Reconcile OpenSpec and Markdown with the hardened contract
- **Status:** complete

### Phase 4: Testing & Verification
- [x] Run focused worker tests and any new regression checks
- [x] Run the broader relevant test/build/static-check surface
- [x] Run strict OpenSpec validation and inspect final diffs/secrets exposure
- [x] Audit every handoff/OpenSpec requirement against fresh evidence
- [x] Rerun all verification after the final-audit corrections
- **Status:** complete

### Phase 5: Delivery
- [x] Ensure no required review finding or document update remains
- [x] Report changed, verified, remaining, and skipped checks with exact evidence
- **Status:** complete

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Use OpenSpec change `update-cloud-summary-azure-responses` | `HANDOFF.md` explicitly identifies it as the change for this work. |
| Use an isolated `.planning` plan | Existing root planning files belong to a different runtime-hardening task and must not be overwritten. |
| Treat current files and fresh command output as authoritative | The handoff contains historical runtime claims that require re-verification before reuse. |
| Require a correction-design checkpoint before code/docs implementation | The mandatory brainstorming workflow applies because the viable fixes change accounting, configuration, and runtime behavior. |
| Treat unknown Luna USD pricing as unresolved data, not a value to infer | Official public sources did not expose a verifiable rate for this deployment/model. |
| Implement approved option A with model-aware, fail-closed pricing | The user selected A and asked for official input/output rates; official catalog and retail-price checks confirm Luna but expose no public Luna meter, so token use must remain visible while USD stays `null`/unpriced. |
| Count cached tokens inside input and reasoning tokens inside output | Azure Responses documents them as detail subsets; adding them again would double-count. |
| Establish a post-migration schema compatibility floor | The previous control-plane omits NOT NULL `pricing_status` and misreads nullable cost; rollback must retain the schema-aware release with cloud routes disabled unless a separately tested compatibility image exists. |

## Errors Encountered
| Error | Resolution |
|-------|------------|
| Initial combined skill/document read was truncated | Re-read required skill and OpenSpec instruction files in bounded chunks. |
| A filtered `docker compose config` diagnostic printed a real API key from adjacent rendered lines | Stopped using rendered full config; use container-scoped allowlists only. Do not record/repeat the value and flag the credential for rotation. |
| First Azure Retail Prices query allowed shell expansion of `$filter` | Retried with an escaped filter; no Luna/5.6 public meter was returned. |
| First workspace-focused Vitest rerun used repo-root test paths | Reran with paths relative to the control-plane workspace; the intended focused suite passed. |
| Final public pricing probe initially had invalid shell quoting | Retried with an escaped `$filter`; the official API returned `Count: 0` with no next page. |
