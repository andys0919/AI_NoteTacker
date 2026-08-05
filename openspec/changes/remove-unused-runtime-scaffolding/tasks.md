## 1. Specification and ticket
- [x] 1.1 Create and strictly validate the OpenSpec proposal, design, tasks, and deltas.
- [x] 1.2 Create GitHub issue `andys0919/AI_NoteTacker#1` for this exact change.

## 2. Runtime dependency simplification
- [x] 2.1 Move the HTTP/S3 artifact downloader into the transcription worker and remove the external package, sibling-checkout, Git-install, compile, and duplicate-test wiring.
- [x] 2.2 Remove Redis from Compose, environment examples, project context, and rollout documentation.
- [x] 2.3 Remove cross-stage worker settings, Codex mounts, summary GPU reservation, and the summary process's Whisper configuration requirement.

## 3. Dead code and obsolete tests
- [x] 3.1 Remove unreachable browser OTP modules/tests and load `app.js` directly.
- [x] 3.2 Remove the test-only job runtime-state module and its test.
- [x] 3.3 Remove unused summary collaborators and obsolete summary assertions from the transcription loop tests.
- [x] 3.4 Remove unreferenced provider predicates, retry/factory helpers, imports, and stored properties found by static checks.
- [x] 3.5 Remove unreachable Azure punctuation-restoration and diarization
  collaborators, provider calls, and focused tests while preserving historical
  artifact and settlement compatibility.

## 4. Canonical repository surface
- [x] 4.1 Delete completed scratch planning records and the unreferenced parallel multilingual design document.
- [x] 4.2 Delete the wrapper-only Makefile and update documentation to use `scripts/deploy.sh` and root npm scripts directly.
- [x] 4.3 Synchronize README, worker documentation, HANDOFF, operations docs, and `openspec/project.md` with the resulting runtime.
- [x] 4.4 Record the required future archive order for the two superseded package changes and this removal.

## 5. Verification and review
- [x] 5.1 Run the affected Node and Python tests once after implementation.
- [x] 5.2 Run the Node/Python builds, canonical Compose renders, strict OpenSpec validation, static dead-reference checks, and `git diff --check`.
- [x] 5.3 Review the full diff from `5444afb` against repository standards and this spec/ticket on separate axes.
- [x] 5.4 Resolve all actionable review findings and repeat only checks affected by later edits.
- [x] 5.5 Run the focused active Azure/MAI/Qwen/worker/config regressions after
  the deletion-only remediation (34 tests pass on 2026-08-04).
