# Findings & Decisions

## Requirements
- Preserve the original spoken language; do not translate non-Chinese speech.
- Convert confidently identified Chinese output to Traditional Chinese.
- Support mixed-language recordings and Taiwanese Hokkien.
- Represent Taiwanese Hokkien with Traditional Chinese characters when strong, and attach Tai-lo candidates when uncertain.
- Preserve immutable raw transcription evidence and expose uncertain candidates instead of silently guessing.
- Make summaries concise and prohibit unsupported facts, actions, risks, and open questions.

## Research Findings
- The current Azure `gpt-4o-transcribe` path returns the ASR text before punctuation restoration.
- The punctuation restorer has a strict character-fidelity guard and correctly cannot repair ASR homophones.
- The reviewed production job used the `general` summary profile even though the content was a sales activity report.
- The current summary prompt asks for detailed coverage of every structured section, encouraging unsupported extrapolation and repetition.
- Official Microsoft documentation says known language hints and domain vocabulary prompts can improve recognition; Azure Speech phrase lists/custom speech are candidates only after benchmark evidence.
- The current artifact only stores one `text` value per segment, so immutable raw text and derived display text require a backward-compatible artifact extension.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Version transcript artifacts and retain legacy `text` reads | Existing jobs and consumers must remain readable. |
| Use explicit workflow glossaries rather than one global vocabulary | Prevent unrelated terms from biasing every recording. |
| Keep job completion non-blocking on human review | Preserve current lifecycle while making uncertainty visible. |
| Use the approved design document as source context | User reviewed and confirmed the written behavior contract. |

## Issues Encountered
| Issue | Resolution |
|-------|------------|

## Resources
- `docs/superpowers/specs/2026-07-15-multilingual-faithful-transcription-design.md`
- `workers/transcription-worker/src/transcription_worker/azure_openai_transcriber.py`
- `workers/transcription-worker/src/transcription_worker/azure_openai_punctuation_restorer.py`
- `workers/transcription-worker/src/transcription_worker/transcript_summary.py`
- `apps/control-plane/src/domain/recording-job.ts`
