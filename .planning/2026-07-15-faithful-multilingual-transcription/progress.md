# Progress Log

## Session: 2026-07-15

### Current Status
- **Phase:** 2 - OpenSpec Artifacts
- **Started:** 2026-07-15

### Actions Taken
- Inspected the live job, database artifacts, usage records, and original audio.
- Confirmed ASR errors were propagated and strengthened by the summary stage.
- Reviewed the live transcription, punctuation, and summary execution paths.
- Researched current official OpenAI and Microsoft transcription guidance.
- Completed, self-reviewed, and committed the approved design as `4cf21ab`.
- Created an isolated planning session so unrelated active work is not overwritten.
- Created all four OpenSpec artifacts for `add-faithful-multilingual-transcription`.
- Passed `openspec validate add-faithful-multilingual-transcription --strict --no-interactive`.
- Stopped at the required proposal approval gate before editing production code.
- Received explicit proposal approval and entered OpenSpec apply/TDD implementation.
- Completed OpenSpec tasks 1.1-1.3: watched callback evidence tests fail because Zod stripped the new fields, extended the transcript contract/schema, and passed 74 targeted API/repository tests plus TypeScript no-emit compilation.
- Completed OpenSpec tasks 2.1-2.6: selected `opencc==1.4.1`, added raw/display normalization, multilingual prompts, workflow sales glossary, non-authoritative domain/Tai-lo flags, claim-context propagation, schema-v2 worker callbacks, and re-ran punctuation fidelity coverage.
- Completed OpenSpec tasks 3.1-3.3: constrained summaries to explicit evidence, retained unresolved flags and high-risk literals, and routed untemplated LINE report-portal uploads to the sales profile without changing unrelated uploads.
- Completed OpenSpec tasks 4.1-4.3: dashboard transcript details now default to display text and expose escaped raw text, candidates, reasons, and evidence timing in an expandable section; legacy segments stay simple and non-JSON exports remain unchanged.
- Completed OpenSpec tasks 5.1-5.2: added versioned corpus/results schemas, a deterministic exact-evidence metric runner, and explicit documentation that production model changes require legally usable reference audio and measured results.
- Completed OpenSpec tasks 5.3-5.4: full Python/Node tests and builds, Compose/OpenSpec validation, production worker image build/import smoke, whitespace/schema checks, and final overlap/no-touch review all passed.

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| OpenSpec strict validation | Change is valid | `Change 'add-faithful-multilingual-transcription' is valid` | passed |
| Transcript artifact RED | Extended callback fields must survive | Failed at `schemaVersion` because existing Zod schema stripped it | expected failure |
| Transcript artifact GREEN | API/repository tests and TypeScript compile | 74 tests passed; `tsc --noEmit` exited 0 | passed |
| Multilingual worker RED | New normalizer/context/evidence contracts | Missing module, missing workflow argument, and missing schema v2 failed as expected | expected failure |
| Multilingual worker GREEN | Config, normalizer, Azure transcriber, worker loop, punctuation | 64 tests passed | passed |
| Evidence summary and routing RED | New evidence/routing contracts | Summary prompt lacked evidence rules; report portal resolved to `general` | expected failure |
| Evidence summary and routing GREEN | Prompt, summary-worker, and upload routing tests | 9 Python unittest cases and 4 Vitest cases passed | passed |
| Operator evidence UI RED | Review renderer module | Module missing as expected | expected failure |
| Operator evidence UI GREEN | Renderer, exports, dashboard route, TypeScript | 63 Vitest cases passed; `tsc --noEmit` exited 0 | passed |
| Benchmark metrics RED | Deterministic metric module | Module missing as expected | expected failure |
| Benchmark metrics GREEN | Metric unit tests and empty-corpus CLI smoke | 2 cases passed; CLI exited 0 | passed |
| Full worker suite | External package plus worker tests | 111 tests passed | passed |
| Full Node suite | Control plane and recording worker | 298 tests passed | passed |
| Builds | TypeScript workspaces and Python compile | all exited 0 | passed |
| Runtime packaging | Compose config, worker image build, OpenCC import/conversion | all exited 0; OpenCC 1.4.1 converted `简体中文软件` to `簡體中文軟體` | passed |
| Spec and hygiene | OpenSpec strict, JSON parsing, `git diff --check` | all exited 0 | passed |

### Errors
| Error | Resolution |
|-------|------------|
| System Python environment was externally managed and the first temporary OpenCC venv did not include pytest | Used unittest-based project runners and a disposable `--system-site-packages` venv with pinned OpenCC 1.4.1 |
| Full worker suite expected the existing “do not omit material discussion points” summary contract | Restored that phrase with an explicit direct-transcript-evidence condition; the full suite then passed |
| Initial image inspection used the previous image because the dependency-heavy build had not completed | Waited for the 1.4 GB NVIDIA dependency build to finish, then verified OpenCC inside the newly tagged image |

### Skipped Checks
- No live Azure transcription or summary call: there is no legally usable, human-verified multilingual reference corpus in the repo, so a paid provider call would not establish comparative quality.
- No production deployment or reprocessing of the historical job: the shared dirty worktree contains the separate `update-cloud-summary-azure-responses` change, whose handoff explicitly says it is not archive-ready. Deploying that combined bundle would exceed this change's no-touch and safety scope.
