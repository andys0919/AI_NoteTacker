# Task Plan: Faithful Multilingual Transcription

## Goal
Implement and verify an evidence-preserving multilingual transcription pipeline that retains spoken languages, normalizes Chinese to Traditional Chinese conservatively, flags uncertain terms, and prevents unsupported summary claims.

## Current Phase
Phase 3

## Phases

### Phase 1: Requirements & Discovery
- [x] Understand user intent
- [x] Identify constraints
- [x] Document the approved design
- **Status:** complete

### Phase 2: OpenSpec Artifacts
- [x] Create the OpenSpec change
- [x] Generate proposal, design, delta specs, and tasks in dependency order
- [x] Validate the change strictly
- [x] Receive proposal approval before production implementation
- **Status:** complete

### Phase 3: Test-first Implementation
- [ ] Add failing contract tests for versioned raw/display transcript artifacts
- [ ] Add failing tests for language-aware Traditional Chinese normalization and review flags
- [ ] Add failing tests for workflow-specific recognition context and sales routing
- [ ] Add failing tests for evidence-constrained summaries
- [ ] Implement the smallest production changes that satisfy the tests
- **Status:** in_progress

### Phase 4: Testing & Verification
- [ ] Run targeted worker and control-plane tests
- [ ] Run full available project verification
- [ ] Run OpenSpec strict validation
- [ ] Document skipped live/provider checks and remaining uncertainty
- **Status:** pending

### Phase 5: Delivery
- [ ] Review the diff against the approved design and no-touch scope
- [ ] Record changed, verified, and remaining work
- [ ] Deliver evidence-based results to the user
- **Status:** pending

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Preserve immutable raw text and derive display text | Later stages must not erase provider evidence. |
| Preserve spoken languages; normalize only confidently Chinese spans | Prevent translation and accidental conversion of Japanese or proper nouns. |
| Keep punctuation word-fidelity guard | Punctuation is not authorized to repair ASR words. |
| Flag uncertain word corrections instead of silently applying them | Accuracy claims must remain honest when audio evidence is ambiguous. |
| Benchmark model changes before rollout | A stronger model name is not proof of better multilingual domain accuracy. |

## Errors Encountered
| Error | Resolution |
|-------|------------|
| Required `writing-plans` skill is unavailable | Use the repository's OpenSpec fast-forward workflow as the closest structured fallback. |
| System Python rejected `pip install --user` under PEP 668 | Created a disposable `/tmp` virtual environment for dependency-backed verification; production installs from `requirements.txt`. |
