## 1. Transcript Artifact Compatibility

- [x] 1.1 Add failing domain and repository tests for optional raw text, display text, language evidence, timing provenance, and review flags while preserving legacy segment reads.
- [x] 1.2 Extend control-plane transcript artifact types, persistence mapping, and callback validation to retain the tested optional fields without changing lightweight list responses.
- [x] 1.3 Add failing detail and JSON export tests that prove new evidence fields survive and legacy artifacts do not gain fabricated evidence.

## 2. Multilingual Worker Pipeline

- [x] 2.1 Add failing worker tests for immutable raw text, display-compatible text, mixed-language preservation, conservative Chinese conversion, and fail-open normalization.
- [x] 2.2 Select and add the smallest maintained Traditional Chinese conversion dependency, then implement a focused language-aware transcript normalizer that never mutates raw text.
- [x] 2.3 Add failing tests for workflow-specific recognition prompts and verified sales terminology without leaking sales vocabulary into general meetings.
- [x] 2.4 Pass explicit workflow context from job claims into Azure transcription and emit backward-compatible extended segments.
- [x] 2.5 Add failing tests and a focused uncertainty analyzer for high-risk domain terms and uncertain Taiwanese Hokkien candidates; keep every candidate non-authoritative.
- [x] 2.6 Re-run punctuation fidelity tests to prove the existing punctuation stage still cannot change words.

## 3. Evidence-Constrained Summaries

- [x] 3.1 Add failing prompt tests for empty unsupported sections, unresolved review flags, literal high-risk values, concise non-repetition, and foreign-language preservation.
- [x] 3.2 Tighten the shared summary prompt while retaining the existing strict six-field JSON response contract.
- [x] 3.3 Add failing submission and worker tests that route sales activity reports through the sales profile and retain general routing for unrelated uploads.

## 4. Operator Review Evidence

- [x] 4.1 Add failing dashboard rendering tests for display text by default and expandable raw text, uncertainty reason, candidates, and timing evidence.
- [x] 4.2 Implement the smallest job-detail UI needed to expose review evidence without adding it to list polling or introducing a blocking correction workflow.
- [x] 4.3 Verify Markdown, text, SRT, and JSON exports remain backward compatible, with review metadata limited to JSON.

## 5. Evaluation and Verification

- [x] 5.1 Add a versioned multilingual benchmark manifest/schema and deterministic metric runner for language preservation, Chinese normalization, domain entities, numerics, unsupported summary claims, latency, and usage.
- [x] 5.2 Document that production model replacement requires legally usable reference audio and measured improvement; do not fabricate missing multilingual corpus results.
- [x] 5.3 Run targeted worker and control-plane tests, full available tests/builds, compose validation, and strict OpenSpec validation; record every skipped live/provider check.
- [x] 5.4 Review the final diff against the approved design, no-touch scope, and the active Azure Responses change before marking tasks complete.
