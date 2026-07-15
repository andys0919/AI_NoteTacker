## Why

The current pipeline preserves punctuation fidelity but cannot distinguish raw speech-recognition evidence from later normalization, and summaries can turn malformed multilingual transcript text into unsupported facts. Real usage includes Chinese, English, Taiwanese Hokkien, other languages, and code-switching, so correctness requires language-preserving artifacts and explicit uncertainty rather than a stronger text model alone.

## What Changes

- Version transcript artifacts so every segment retains immutable provider text alongside derived display text, language evidence, timing provenance, and review flags.
- Preserve spoken languages, convert only confidently identified Chinese spans to Traditional Chinese, and represent uncertain Taiwanese Hokkien with visible Traditional-character and Tai-lo candidates.
- Build transcription context from the explicit workflow template and verified domain glossary instead of one global Chinese prompt.
- Keep punctuation restoration word-fidelity guarded and separate from terminology or word-correction analysis.
- Constrain summaries to transcript-supported facts and empty unsupported structured sections; route sales activity reports through the existing sales profile.
- Expose raw text and uncertainty evidence through on-demand job detail and JSON export while keeping existing transcript consumers compatible.
- Add a multilingual evaluation contract so provider or model changes require measured improvement on high-risk terms, numbers, and unsupported-summary claims.

## Capabilities

### New Capabilities
- `faithful-multilingual-transcription`: Language preservation, Traditional Chinese normalization, raw/display transcript evidence, workflow glossaries, uncertainty flags, and multilingual quality measurement.

### Modified Capabilities
- `meeting-summary-generation`: Require evidence-constrained summaries that do not invent actions, risks, decisions, or open questions from malformed or uncertain transcript text.
- `operator-dashboard`: Expose raw transcript evidence and review flags only in on-demand job detail while keeping list responses lightweight.

## Impact

- Affected code: transcription-worker recognition/configuration/normalization, summary prompting, recording-job transcript artifact types and persistence, upload workflow-template routing, job-detail rendering and exports, and related tests.
- API impact: transcript segment detail gains backward-compatible optional raw/display, language, timing-provenance, and review-flag fields; the existing `text` field remains the display-compatible value.
- Dependency impact: add a maintained Simplified-to-Traditional conversion library only if the repository does not already provide a suitable deterministic converter.
- Operational impact: transcript artifacts grow modestly; additional analysis must fail open to preserved text and must not block job completion.
- Related active change: `update-cloud-summary-azure-responses` owns Responses transport, punctuation metering, and strict provider usage. This change preserves those contracts and must not duplicate or weaken them.
