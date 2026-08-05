## 1. Contract and issue

- [x] 1.1 Validate this OpenSpec change strictly and create tracking issue #3 with the live failure and redacted PLAUD comparison evidence.
- [x] 1.2 Amend `update-cloud-summary-azure-responses` so its retry contract permits only one identical summary HTTP 400 retry.

## 2. Job-specific recognition context

- [x] 2.1 Add focused control-plane tests for glossary validation, persistence, API/claim exposure, and legacy empty-glossary compatibility.
- [x] 2.2 Add the upload glossary field and smallest durable recording-job/PostgreSQL plumbing.
- [x] 2.3 Add worker tests for glossary syntax, canonical prompt terms, accepted display-only alias correction, immutable raw text, and review evidence.

## 3. Azure transcription coverage

- [x] 3.1 Add a regression test proving split uploads use five-minute chunks and the next request receives only a bounded preceding transcript tail.
- [x] 3.2 Add a regression test proving an audible sparse five-minute response retries up to twice and a third sparse response fails.
- [x] 3.3 Implement the five-minute chunk, continuity prompt, and existing sparse-retry threshold changes without a new retry abstraction.

## 4. Azure summary resilience

- [x] 4.1 Add tests for HTTP error-body preservation, one identical HTTP 400 retry, no retry for other failures, and retry request-count metadata.
- [x] 4.2 Implement the typed Responses HTTP error and summary-only bounded retry.
- [x] 4.3 Persist provider/unmetered summary request counts and keep partially metered retried usage unpriced.
- [x] 4.4 Add a focused prompt regression and keep operator-verified aliases authoritative while tentative or later-to-be-confirmed points remain out of decisions.

## 5. Upload boundary

- [x] 5.1 Add a small-limit regression test for structured HTTP 413 and temp-file cleanup.
- [x] 5.2 Raise the default limit to 512 MiB and map Multer `LIMIT_FILE_SIZE` without buffering uploads in memory.

## 6. Verification

- [x] 6.1 Run only the affected worker tests, control-plane tests, TypeScript build, and strict OpenSpec validation.
- [x] 6.2 Re-run the full HDD transcription with the verified glossary and Sol summary, then record coverage, terminology, unsupported-claim, latency, and request-count results against both the old result and PLAUD.
- [x] 6.3 Run Standards and Spec reviews, fix material findings, and record any remaining diarization quality gap.
- [x] 6.4 A/B `gpt-4o-transcribe-diarize` without a phrase list on the oracle-free 780–840 second interval and keep it benchmark-only after unsupported English and speaker-assignment errors.
- [x] 6.5 Re-run `gpt-4o-transcribe-diarize` on five minutes of lossless PCM without a phrase list; retain the primary ASR for text and record the PLAUD-relative speaker evidence separately.

## 7. Generic recognition uncertainty

- [x] 7.1 Run an oracle-free probe with Azure OpenAI log probabilities, an independent Azure OpenAI sample, and standard Azure Speech; record the high-confidence error and cross-provider disagreement.
- [x] 7.2 Defer the verifier implementation and its normative requirement to a future change because no tested candidate cleared the terminology/fidelity gate and no ongoing latency/cost policy was selected.

## 8. Historical hybrid speaker evidence (runtime later superseded)

The completed experiments and implementation tasks below are retained as
history. `simplify-mai-transcription-pipeline` supersedes their runtime use, and
`refine-meeting-artifact-reader` supersedes their speaker presentation.

- [x] 8.1 Approve opt-in diarization latency/provider use and verify the Azure deployment accepts automatically extracted known-speaker references without a phrase list.
- [x] 8.2 Add focused transcriber tests for PCM diarization, cross-chunk anonymous references, conservative alignment, immutable primary text, bounded transient `DeploymentNotFound` retries, and graceful speaker-evidence failure.
- [x] 8.3 Implement the optional diarization pass behind the existing `transcribe(...) -> artifact` seam with bounded parallelism and no new provider framework.
- [x] 8.4 Add optional transcript speaker metadata, visible rendering/export, and separate unpriced diarization usage settlement with focused control-plane tests.
- [x] 8.5 Re-run the same HDD interval through the implemented hybrid path and compare primary-text identity, attributed-segment coverage, speaker agreement, latency, request counts, and unresolved labels against PLAUD.
- [x] 8.6 Run targeted worker/control-plane verification, strict OpenSpec validation, and final Standards/Spec reviews; fix all material findings.
- [x] 8.7 Retry identical diarization HTTP 400 and transient transport failures with bounded backoff after the unstable-network full-file run exposed 15 failed chunks.

## 9. HTTP 200 repetitive transcript recovery

- [x] 9.1 Add a focused regression proving a highly compressible HTTP 200 transcript is rejected and recovered from the same audio in 30-second chunks.
- [x] 9.2 Extend the existing sparse-retry seam with the standard-library gzip gate, bounded retry, previous-generated-context removal, usage accounting, and cleanup.
- [x] 9.3 Run the focused transcription-worker test file, strict OpenSpec validation, and replay the gate against the stored full Azure artifact.

## 10. Generic topic-based summary structure

- [x] 10.1 Preserve the operator-supplied PLAUD transcript and summary as a comparison-only Markdown artifact without the share token.
- [x] 10.2 Add content-derived summary topics with explicit `confirmed`, `mixed`, or `open` status while retaining the existing flat structured fields.
- [x] 10.3 Render topic conclusions and only non-empty follow-up, decision, risk, and open-question sections; keep historical artifacts readable.
- [x] 10.4 Run the focused worker/control-plane tests, build, visual smoke, and strict OpenSpec validation.

## 11. Coverage-first summary and no Speaker classification

- [x] 11.1 Stop canonical diarization injection while preserving historical artifact compatibility and omitting stored labels from summary, readers, and text exports.
- [x] 11.2 Make the generic prompt cover material discussion across the full transcript and classify explicit actions, decisions, risks, and open questions without benchmark-specific hints.
- [x] 11.3 Run focused regressions, strict OpenSpec validation, rebuild the affected services, and verify live behavior.
- [x] 11.4 Obtain a completed oracle-free Luna/max comparison and record the 265.5-second response, hierarchy coverage, terminology limits, and PLAUD-relative trade-offs.

## 12. Fluent hierarchical Luna summary

- [x] 12.1 Specify and ticket a content-derived topic/subtopic structure, grouped explicit follow-ups, evidence-backed analysis notes, and semantic compression without numeric topic limits.
- [x] 12.2 Extend the shared summary prompt/parser and derive legacy flat fields without a second model request or transcript polishing stage.
- [x] 12.3 Preserve the additive hierarchy through the worker event, control-plane schema, Markdown, and operator reader while keeping historical artifacts compatible.
- [x] 12.4 Raise the summary socket timeout to 900 seconds, run focused worker/control-plane checks and strict OpenSpec validation, rebuild/recreate the affected services, and verify live health and loaded runtime behavior.

## 13. Contract supersession review

- [x] 13.1 Replace the obsolete optional-diarization requirement with historical-artifact compatibility and record the later runtime/presentation owners without archiving either change.
