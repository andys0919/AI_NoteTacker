# Progress Log

## Session: 2026-07-15

### Current Status
- **Phase:** 5 - Final delivery reconciliation
- **Started:** 2026-07-15

### Actions Taken
- Read `HANDOFF.md`, repository OpenSpec instructions, and the selected skills.
- Inspected existing planning files and confirmed they belong to another task.
- Captured initial git status: modified `.env.example`, summarizer/restorer code
  and tests; new shared Responses module, OpenSpec change, and `HANDOFF.md`.
- Created isolated plan `2026-07-15-review-azure-responses-handoff`.
- Ran OpenSpec list/status/apply-instructions and selected the change's concrete
  proposal/spec/tasks context files.
- Found 16/16 tasks checked but `openspec status` still reports the change incomplete
  because its design artifact has not been created.
- Recorded current branch, dirty-worktree scope, and recent commit context.
- Read all selected OpenSpec context artifacts and the published summary spec.
- Traced both production callers through config, worker construction, shared adapter,
  summary event mapping, Docker Compose, and baked-image build behavior.
- Confirmed two spec/code/config gaps: stale chat-endpoint fallback and acceptance of
  non-completed Responses payloads with output text.
- Ran pre-fix focused and full baseline tests; all current suites passed (259 total),
  demonstrating missing coverage rather than an already-red suite.
- Found canonical production compose overrides that hard-code `gpt-5.4-mini` and
  override the `.env` Luna model on normal `scripts/deploy.sh` runs.
- Identified related stale Markdown in root/worker READMEs and OpenSpec project context.
- Inspected live compose provenance and found a mixed base/screenapp deployment history.
- Logged a diagnostic-output secret exposure; stopped full Compose rendering and will
  require the affected credential to be rotated without reproducing it in artifacts.
- Audited cloud cost settlement and separated verified token mapping from unverified
  model-specific billing rates; official public sources did not provide a usable Luna rate.
- Completed independent architecture, implementation/test, and OpenSpec/document reviews
  and reconciled their findings against the live caller/config/deployment paths.
- Dynamically reproduced acceptance of an `incomplete` Responses payload and corruption
  caused by newline insertion between split output-text blocks.
- Confirmed requests omit `store: false`, summary usage mishandles missing/null usage, and
  punctuation token usage/cost and fallback observability are absent end to end.
- Confirmed malformed Azure summary output currently reports a misleading Codex error
  because provider-neutral parsing is hidden in the Codex adapter's private helpers.
- Confirmed the selected change is not archive-ready despite 16/16 task checkboxes: it
  lacks required design, places punctuation in the summary capability, and overlaps active
  summary deltas whose archive ordering can overwrite requirements.
- Stopped before behavior-changing edits to satisfy the mandatory design-approval gate;
  next action is to present concrete correction shapes and resolve the unverifiable Luna rate.
- Received explicit user approval for option A plus an official input/output rate lookup.
- Verified that official public Azure sources currently publish no Luna/5.6 retail meter;
  selected fail-closed unpriced accounting instead of retaining the generic fixed rate.
- Added red-then-green worker regressions for Responses `store: false`, exact fragment
  concatenation, non-completed status handling, strict usage, finite caller-specific
  timeouts, explicit Responses-only configuration, model-preserving production Compose,
  punctuation usage aggregation/fallback observability, and event propagation.
- Refactored provider-neutral summary parsing out of the Codex adapter and fixed Azure
  diagnostics so malformed Azure results no longer claim they came from Codex.
- Removed the production screenapp model override and both legacy Chat/key fallbacks;
  invalid or missing Responses configuration now fails readiness/startup explicitly.
- Ran the formal worker harness after these changes: package tests 2/2 and worker tests
  83/83 passed. A later focused Responses parser check also passed 9/9 after adding the
  incomplete reason to its error; the full harness remains to be rerun at final verification.
- Queried the official Retail Prices API for `gpt-4o-transcribe` meters and found that
  Azure bills separate audio-input, text-input, and text-output tokens. The existing
  audio-duration “actual” formula is therefore being corrected to fail closed; its
  per-minute value remains an estimate for preflight reservations only.
- Tightened Responses usage validation to require the officially required cached-input
  and reasoning-output detail fields. The fresh formal worker harness now passes 2/2
  package tests and 84/84 worker tests.
- Completed and independently reran the cloud-usage domain/repository slice: nullable
  unpriced entries, punctuation stage, immutable idempotent append, lower-bound totals,
  conservative legacy migration, and PostgreSQL parity pass 3 files / 16 tests.
- Corrected the reservation estimate variant/unit mix-up: full `gpt-4o-transcribe`
  now uses the US$0.006/minute planning estimate, while the US$0.003/minute estimate is
  reserved for `gpt-4o-mini-transcribe`; neither value is used as actual settlement.
- Reconciled OpenSpec with the tested contract by replacing newline insertion with exact
  fragment concatenation and removing unapproved transactional/cutover/no-charge claims;
  selected-change strict validation passes after the correction.
- Preserved valid provider usage on invalid summary status/output/JSON failures and settled
  it through `summary-failed`; cloud transcription and summary callbacks now require their
  scheduler-issued lease token rather than sharing a `legacy` idempotency key.
- Added one exact terminal callback delivery retry without repeating provider work or
  converting success into a contradictory failure callback.
- Preserved duration for every successful Azure transcription upload even when a later
  chunk/retry fails, and exposed transcription `audioMs` as seconds in the admin job modal.
- Made Responses pricing rows structurally require authoritative base model/version,
  SKU or service tier, USD currency, effective date, and meter source; production remains
  fail-closed with an empty Luna pricing catalog.
- The first full post-fix run exposed four governance test failures. Root-cause tracing
  showed old fixtures bypassed the claim routes and omitted newly required lease tokens;
  the report failure was downstream of rejected callbacks. Updated the tests to claim the
  actual transcription/summary leases and assert terminal event success.
- Updated OpenSpec and Markdown to describe `urlopen` socket-operation timeout semantics,
  the narrow `store: false` application-state effect, exact callback delivery retry, the
  official pricing evidence boundary, and final local verification status.
- Final complete local verification passed: `npm test` 345 tests, `npm run build`, four
  browser-JS syntax checks, selected and all-change strict OpenSpec validation (22/22),
  `git diff --check`, canonical Compose boolean validation, and scoped provenance scan.
- A later independent architecture audit invalidated the delivery checkpoint by dynamically
  reproducing three lease-boundary P1 defects: unissued tokens could append usage, cloud
  failures without usage could omit leases, and a new lease installed during ledger append
  could be overwritten by the callback's stale job snapshot. It also reproduced acceptance
  of an empty structured summary, invalid/negative pricing rows, and missing socket-operation
  timeouts on Azure transcription/control-plane HTTP calls. Corrective TDD is now in progress;
  the prior 345-test result remains historical pre-correction evidence, not final proof.
- Closed all six final-audit defects: strict six-field Azure summaries, Azure transcription
  and control-plane socket-operation timeouts, fail-closed pricing-row validation, mandatory
  issued cloud terminal tokens, append-only per-stage issued-token histories, and repository
  active-lease compare-and-save after settlement.
- Added PostgreSQL claim/history interleaving tests, monotonic general-save behavior, active
  pre-migration token backfill, hidden-job settlement protection, and public-payload
  non-disclosure checks. A second read-only lease audit found no remaining correctness issue.
- Root independently reran the final repository checks: `npm test` passes 393 tests
  (control-plane 282, recording worker 13, external Python package 2, transcription worker
  96); build, four browser syntax checks, selected/all OpenSpec strict validation, diff check,
  safe Compose boolean, and scoped sensitive-host scan also pass.
- A final read-only audit then found two fail-closed gaps: callbacks with reported usage could
  advance lifecycle when quota/pricing identity was absent, and blank model/pricing-version
  catalog identities could be priced. Four red regressions reproduced both defects; the
  minimal fixes now return a settlement conflict before mutation and reject blank identities.
- A subsequent whitespace/date audit added three more red cases and closed them by requiring
  a real `YYYY-MM-DD` calendar date plus a nonblank pricing version before settlement.
- Corrected the rollback architecture after proving the old control-plane cannot write the
  migrated NOT NULL `pricing_status` column or interpret nullable cost safely. Post-migration
  rollback now retains the schema-aware release and disables cloud routes; restoring old
  binaries requires a separately exercised compatibility image, so task 6.7 stays open.
- Corrected timeout documentation to the Python transcription/summary workers and documented
  the real rollout boundary: stop new claims while old control-plane instances continue
  accepting already-issued callbacks, drain or explicitly handle those attempts, then stop
  old instances before active-token backfill. Real PostgreSQL concurrency/rolling migration,
  live E2E, rollback, deployment, Cost Details access, commit/push, and archive were not
  performed.

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `python3 scripts/run_transcription_worker_tests.py` | package and worker suites pass | 2/2 package, 96/96 worker | pass |
| focused Responses adapter unittest | all adapter contracts pass | 10/10 | pass |
| production Compose sentinel test | screenapp merge preserves configured summary model | sentinel preserved in both workers | pass |
| focused cloud usage domain/repository tests | nullable pricing and persistence parity pass | 3 files, 16/16 | pass |
| selected OpenSpec strict validation | change is valid | valid | pass |
| root `npm test` after all final-audit fixes | all suites pass | control-plane 282, recording worker 13, external Python package 2, transcription worker 96 (393 total) | pass |
| `npm run build` | TypeScript and Python builds pass | exit 0 | pass |
| browser JavaScript syntax | all four changed browser files parse | 4/4 | pass |
| all OpenSpec strict validation | every active change/spec validates | 22/22 | pass |
| canonical production Compose check | both workers resolve Luna + Responses URL shape + nonempty key without printing secrets | `true` | pass |
| final whitespace/provenance checks | no diff whitespace errors or scoped real-host markers | exit 0 | pass |

### Errors
| Error | Resolution |
|-------|------------|
| Combined read exceeded output limit | Re-read required files in bounded chunks. |
| Filtered Compose config output included a real API key | Switched to allowlisted non-secret inspection; value will not be copied into any file or final response. |
| Initial Retail Prices API command expanded `$filter` in the shell and returned unrelated data | Escaped the query parameter and retried; the corrected query exposed no public Luna/5.6 meter. |
