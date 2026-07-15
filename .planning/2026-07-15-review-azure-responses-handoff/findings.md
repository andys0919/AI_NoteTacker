# Findings & Decisions

## Requirements
- Review `HANDOFF.md` completely and verify architecture and code correctness.
- Use the existing OpenSpec change and keep its artifacts consistent with implementation.
- Update relevant Markdown with evidence-backed current status, caveats, and remaining work.
- Preserve unrelated user changes and do not expose or commit real `.env` secrets.
- Verify the actual caller/export/shared-utility execution path before editing.

## Research Findings
- `HANDOFF.md` selects `openspec/changes/update-cloud-summary-azure-responses/`.
- Worktree is on `main` with uncommitted Azure Responses implementation, tests,
  `.env.example`, OpenSpec artifacts, and an untracked handoff.
- Existing root `task_plan.md`, `findings.md`, and `progress.md` describe a separate
  runtime-hardening effort; this review uses an isolated plan.
- Historical claims in `HANDOFF.md` include deployed/live evidence, but current
  completion must be proved from fresh local and, where safely available, live evidence.
- OpenSpec selected change reports 16/16 implementation tasks complete and
  `instructions apply` returns `all_done`.
- OpenSpec artifact status is internally inconsistent with archive readiness:
  `openspec status` reports `isComplete: false` because `design.md` is still `ready`
  (not created), even though the apply instructions say ready to archive.
- Repository OpenSpec rules call for `design.md` for cross-cutting work or a new
  architectural pattern. This change introduces a shared Responses API adapter and
  migrates two callers, so the missing design artifact requires explicit review.
- Published `meeting-summary-generation` exists and must be compared with the delta;
  other active changes also touch the same capability and may conflict at archive time.
- Current branch/worktree: `main` equals `origin/main`; implementation is uncommitted.
  `git diff --stat` omits untracked shared helper/OpenSpec/HANDOFF files, so final scope
  checks must include `git status` and direct reads, not only tracked diffs.
- The historical handoff's “only remaining commit/push and archive” claim is not yet
  supported by fresh evidence and conflicts with the missing OpenSpec design artifact.
- Actual execution path is centralized as intended: `summary_main.py` registers
  `AzureOpenAiTranscriptSummarizer`; `main.py` injects
  `AzureOpenAiPunctuationRestorer` into `AzureOpenAiTranscriber`; both call the new
  `azure_openai_responses.py` adapter. Docker images copy worker `src`, so code is
  baked into both worker images.
- Confirmed migration defect in `config.py`: when
  `AZURE_OPENAI_SUMMARY_ENDPOINT` is absent, it still derives
  `<AZURE_OPENAI_ENDPOINT>/openai/v1/chat/completions`. The migrated callers then
  send a Responses request shape to a Chat Completions URL. Existing
  `test_config.py` explicitly locks in the stale URL, so current tests cannot catch
  this incompatibility.
- The delta spec requires “empty or non-completed responses fail explicitly,” but
  `AzureOpenAiTranscriptSummarizer` only rejects empty extracted text. A payload with
  `status: incomplete` plus partial `output_text` is accepted as a successful summary;
  current tests cover empty output only.
- The shared HTTP adapter calls `urlopen` without a timeout. This was inherited from
  the former callers, but for punctuation it means an unresponsive request can block
  transcription indefinitely despite the best-effort fallback promise; assess as a
  resilience risk separately from migration-contract defects.
- Usage mapping reaches `summary_worker_loop.py`, which converts snake_case fields
  to the control-plane event's `promptTokens`/`completionTokens`/`totalTokens` fields.
- Microsoft Foundry's current official REST reference confirms the implemented core
  contract: POST `/openai/v1/responses`, `api-key` authentication, `input` and
  optional `instructions`, message content with `type: output_text`, and usage fields
  `input_tokens`, `output_tokens`, and `total_tokens`.
- The same official reference defines response statuses `completed`, `failed`,
  `in_progress`, `cancelled`, `queued`, and `incomplete`. Therefore treating any
  non-`completed` payload with partial output as success is a confirmed contract bug,
  not a speculative interpretation.
- The API version query is optional and defaults to `v1`, so the configured endpoint
  without `?api-version=` is valid according to the current reference.
- Confirmed production deployment defect: canonical `scripts/deploy.sh` always merges
  `docker-compose.screenapp.yml`, and that override hard-codes `SUMMARY_MODEL:
  gpt-5.4-mini` for both transcription and summary workers. Compose mapping merge wins
  over base `.env` interpolation, so a normal production redeploy can silently undo
  `.env`'s `gpt-5.6-luna` model for both punctuation and summary.
- The same stale Chat Completions fallback exists in control-plane
  `summary-provider-catalog.ts`, which can mark Azure summary “ready” using only the
  transcription endpoint/key even though workers now require a Responses endpoint.
  Readiness and worker configuration would therefore agree on an invalid URL rather
  than fail fast.
- Documentation is stale in multiple relevant places: worker README still calls the
  punctuation model a chat model; root README's current defaults contradict
  `.env.example`; `openspec/project.md` still names `gpt-4o-mini-transcribe` instead
  of the current `gpt-4o-transcribe`; root README omits Azure summary Responses env
  requirements and the selected change from validation guidance.
- Fresh pre-fix baseline `npm test` passes: control-plane 191, recording-worker 13,
  external meeting-ai-pipeline 2, transcription-worker 53 (259 total). This makes the
  handoff's “49 relevant + two import failures” note historical rather than current.
- Fresh focused baseline also passes 15 worker/config tests, 5 control-plane files / 23
  tests, Python compileall, and selected-change strict OpenSpec validation.
- Live container labels show the July 14 control-plane/transcription/summary recreations
  used only `docker-compose.yml`, while the older recording/meeting-bot containers came
  from the canonical screenapp file set. This mixed compose provenance explains how
  current workers can use Luna even though the next canonical full deploy would apply
  the stale screenapp model override.
- Cost accuracy is not established by the change. `calculateAzureSummaryCostUsd`
  applies fixed rates (`$0.001/$0.002 per 1K input/output tokens`) to every Azure
  summary and does not accept a model parameter. The handoff's `$0.017498` is exactly
  that local formula for 10,120/3,689 tokens, not evidence that it matches Luna billing.
- Microsoft's official pricing page states inference cost varies by model, but its
  public dynamic table did not expose a verifiable `gpt-5.6-luna` rate in available
  content. The official model catalog confirms Luna exists and supports Responses,
  but not its price. Therefore actual USD correctness must be marked unverified unless
  the deployment's contracted Azure rate is supplied and encoded in pricing catalog v1.
- The shared parser joins separate `output_text` blocks with a newline after stripping
  each block. The official `openai-python` `Response.output_text` convenience property
  concatenates blocks without inserting characters. A JSON string split across two
  blocks therefore becomes different/invalid content in the current adapter; concatenate
  exact text fragments first, then trim only the final combined value.
- Responses requests do not set `store: false`. Microsoft's Azure Responses guide says
  response data is retained for 30 days by default; neither caller uses persisted response
  state. Sending `store: false` is therefore the narrow privacy-correct behavior for full
  meeting transcripts and punctuation chunks, while avoiding claims that this disables
  every other Azure caching mechanism.
- Summary usage handling is not robust to the API's optional `usage` field: missing usage
  silently becomes fabricated zero-token usage, while `usage: null` raises an attribute
  error. A successful billable response must not be recorded as a precise zero-dollar
  call merely because metering fields were absent.
- Azure summary parsing reuses provider-neutral helpers that live as private functions in
  the Codex adapter. Malformed Azure output consequently produces operator errors saying
  “codex returned ...”. The contract should move to a neutral summary module or accept a
  provider label; this is a small correctness fix, not a reason for a broad refactor.
- Punctuation usage is discarded entirely. The restorer returns text only, the transcriber
  emits only `audio_ms`, and the control plane settles only speech-to-text audio plus the
  later summary stage. Every Luna punctuation call is therefore invisible to quota,
  reporting, and actual-spend governance. The OpenSpec change needs an explicit billable
  punctuation contract and idempotent ledger settlement, not only summary token mapping.
- Punctuation failures are also operationally silent: exceptions fall back to raw text
  without a per-job attempted/succeeded/fallback/timeout signal. Best-effort behavior is
  appropriate, but it still needs non-sensitive aggregate observability.
- The admin-selected summary model and punctuation model have different lifecycles:
  summary is snapshotted per job, while punctuation reads process-start environment.
  Documentation must not claim an admin model switch automatically changes punctuation;
  either model ownership must be decoupled explicitly or punctuation must become job data.
- `HANDOFF.md` rollback is unsafe: changing only the endpoint back to Chat Completions
  leaves a Responses request/parser baked into the worker image, and `git checkout --`
  after a commit does not restore the pre-change revision or delete the new helper. A
  rollback must atomically restore code, env, and DB policy, rebuild/recreate all affected
  services, and verify the resolved contract.
- The selected OpenSpec punctuation requirement is placed under
  `meeting-summary-generation`, whose published purpose covers summary outcomes only.
  A separate `transcript-punctuation-restoration` capability is the coherent boundary.
- Four active changes overlap `meeting-summary-generation`; strict validation does not
  detect archive-order/full-MODIFIED-requirement overwrite hazards. The selected change
  must not be archived until its design/capability split is complete and the upstream
  summary changes have been rebased/archived in a safe order.
- Current DB state has no retained Luna artifact or Luna usage-ledger row, and the saved
  sample artifact is from an older local-Codex/model snapshot. The handoff's quality and
  end-to-end claims are historical observations, not independently reproducible current
  evidence; any final claim needs a fresh sanitized probe or an explicit historical label.
- The user approved correction shape A and explicitly asked for official input/output
  rates. The official model catalog identifies `gpt-5.6-luna` version `2026-07-09` and
  Responses support, but the official Azure pricing page and a complete Azure Retail
  Prices API scan expose no 5.6/Luna public meter as of 2026-07-15.
- The workspace has no Azure ARM/Cost Management credentials or Azure CLI context from
  which to resolve the deployment's base model, version, SKU/service tier, currency, and
  subscription-specific `EffectivePrice`. An inference API key is not billing access.
- Consequently the fixed US$1 input / US$2 output per million-token formula is not an
  official Luna rate. Correct behavior is fail-closed pricing: preserve input, cached,
  output, reasoning, and total tokens; set `pricingStatus: unpriced` and `costUsd: null`;
  never render the unknown amount as zero or include it in a supposedly complete total.
- Cached input tokens are a subset of input tokens and reasoning output tokens are a
  subset of output tokens. A future priced formula must use uncached input plus cached
  input at their respective rates and ordinary output rate once, without adding reasoning
  tokens a second time.
- A second official Retail Prices lookup disproves the existing transcription “actual”
  formula. `gpt-4o-transcribe` has separate audio-input, text-input, and text-output token
  meters; the worker currently reports only `audioMs`. In East US 2 the public PAYG rows
  expose Global prices of US$6/US$2.50/US$10 per million tokens and Data Zone/Regional
  prices of US$6.60/US$2.75/US$11, but the repo lacks the token counts and deployment SKU
  needed to choose/apply them. The current US$0.003/minute mapping also uses a constant
  named for the mini model while the configured model is the non-mini deployment.
- Therefore the existing duration formula is suitable only for reservation estimation;
  a completed transcription with only duration must also settle as unpriced/null. Historical
  duration-derived numeric ledger rows cannot be certified as actual and must not be
  automatically promoted to priced during migration.
- Final audit corrections preserve valid Responses usage even when summary validation fails,
  reject cloud settlement without a lease token, resend an identical terminal callback once,
  retain partial successful transcription-upload duration on later failure, render
  transcription duration correctly in admin detail, and enforce pricing provenance fields.
- A full-suite failure after those changes was test-fixture drift rather than an application
  defect: governance scenarios bypassed scheduler claims, so new lease-token validation
  rejected their callbacks. Driving the real claim routes restored the intended contract and
  the complete 345-test suite passed.
- The later architecture audit exposed six additional contract defects. The final tree now
  rejects schema-incomplete Azure summaries while retaining valid usage, applies explicit
  timeouts to Azure transcription and transcription/summary worker-to-control-plane operations, validates
  pricing rows mechanically, rejects missing/never-issued cloud terminal tokens, persists
  append-only per-stage issued histories, and guards lifecycle/artifact saves with an atomic
  active-lease comparison after usage settlement.
- PostgreSQL claims compare the selected issued history and append the new token in one
  conditional update; schema initialization backfills still-active pre-migration tokens.
  Rolling deployment must stop new claims while the old control-plane accepts existing
  callbacks, drain or explicitly handle old attempts, and only then stop old binaries before
  migration. Cleared historical tokens cannot be reconstructed, and real-PostgreSQL
  concurrency was not exercised here.
- The last code audit found and the final tree closes two more fail-closed defects: usage
  settlement without quota/pricing identity now conflicts before lifecycle mutation, and
  pricing rows with blank deployment model or pricing version remain unpriced.
- Follow-up regression cases now also reject blank/impossible quota-day values and blank
  pricing versions. The migration establishes a forward schema floor: previous control-plane
  binaries cannot write NOT NULL `pricing_status` or safely read nullable cost, so
  post-migration rollback retains the schema-aware release and disables cloud routing until a
  separately tested compatibility image exists.
- Final root verification is 393/393 tests plus build, browser syntax, 22/22 strict OpenSpec,
  diff, safe Compose, and scoped sensitive-host checks. Live E2E, rollback, deployment,
  subscription `EffectivePrice`, commit/push, and archive remain unperformed.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Verify before applying or archiving | OpenSpec tasks and handoff say done, but their claims are not proof of the current worktree. |
| Do not archive during review unless every archive precondition is freshly proven | Archive changes published specs/current truth and is beyond a mere documentation correction if evidence is incomplete. |
| Present and obtain approval for a correction design before implementation | The required brainstorming workflow gates behavior-changing edits; the review found multiple materially different accounting/configuration shapes. |
| Do not invent Luna USD rates | Public official sources confirm model-dependent pricing but not this deployment's contracted rate; billing values require user/provider evidence. |
| Keep quota arithmetic as a known-cost lower bound while any entry is unpriced | Reservations still need deterministic arithmetic, but API/UI must expose incomplete actual cost rather than calling the known subtotal the full amount. |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| Initial tool output truncated long instruction files | Re-read them in smaller line ranges before acting. |
| Filtered Compose rendering exposed a real API key in command output | Do not retain or repeat the value; switched to explicit non-secret allowlists and flag credential rotation as required follow-up. |
| First Azure Retail Prices API probe let the shell expand `$filter`, returning an unrelated page | Retried with the query parameter escaped; no public Luna/5.6 meter was returned, so no rate was inferred. |

## Resources
- `HANDOFF.md`
- `openspec/AGENTS.md`
- `openspec/project.md`
- `openspec/changes/update-cloud-summary-azure-responses/`
- Microsoft Foundry REST reference: https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/responses
- Microsoft Azure Responses guide: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses
- Official `openai-python` response text implementation: https://github.com/openai/openai-python/blob/main/src/openai/types/responses/response.py
- Microsoft Azure OpenAI pricing: https://azure.microsoft.com/en-us/pricing/details/azure-openai/
- Microsoft model catalog: https://learn.microsoft.com/fr-ch/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure
- Azure Retail Prices API: https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices
- Azure Cost Details fields / `EffectivePrice`: https://learn.microsoft.com/en-us/azure/cost-management-billing/automate/understand-usage-details-fields
- Azure OpenAI data privacy: https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/data-privacy
