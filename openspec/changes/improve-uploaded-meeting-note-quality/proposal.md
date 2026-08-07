# Change: Improve Uploaded Meeting Note Quality

## Why

A live 93-minute HDD workflow meeting exposed four concrete gaps. The
318,461,086-byte source video exceeded the control-plane's 250 MiB Multer limit
and surfaced as HTTP 500; 20-minute Azure transcription chunks omitted material
speech and misheard verified terms; an audible five-minute chunk temporarily
returned only 75 characters with HTTP 200; and the first Azure summary request
returned HTTP 400 even though the exact same request succeeded immediately
afterward.

The same recording also showed that PLAUD is not a safe ground truth: its
transcript had materially greater coverage and speaker labels, but its summary
promoted pending discussion to decisions and introduced unsupported details.
The target is therefore measurable coverage and terminology improvement while
remaining more evidence-faithful than PLAUD. Terms learned from that recording,
PLAUD, or a human reference cannot be passed back to a provider when measuring
general ASR quality; that would measure an assisted workflow rather than the
model.

## What Changes

- Let upload operators provide a small, job-specific list of verified terms,
  phrases, and exact aliases; persist it with the job and pass it to Azure
  transcription as an optional assisted workflow, not as a prerequisite for
  general recognition.
- Keep provider `rawText` immutable while allowing an explicitly verified alias
  to correct only `displayText`, with correction evidence retained for review.
- Limit Azure transcription chunks to five minutes, carry a bounded tail of the
  preceding transcript into the next prompt, and retry one audible sparse
  five-minute result up to twice with the same audio and context.
- Treat an HTTP 200 transcript with extreme text compression as a content
  failure, retry the same original audio in at most 30-second chunks without
  preceding generated transcript context, and fail explicitly if two bounded
  retries remain sparse or repetitive.
- Preserve an Azure summary HTTP 400 and its redacted provider error body
  without replaying the paid request; retain request-level outcome and usage
  evidence when available.
- Feed operator-verified display terminology to summaries without relabelling
  it as unconfirmed, and keep tentative or later-to-be-confirmed points out of
  `decisions`.
- Add a generic topic-based summary structure with explicit confirmed, mixed,
  or open status; cover material discussion across the full recording, classify
  explicit actions, decisions, risks, and open questions separately, render
  only supported non-empty sections, and keep existing flat summary fields for
  backward-compatible export and sharing.
- Generate one fluent, content-derived Traditional Chinese meeting article in
  the existing Luna/max summary call: organize independent decision domains as
  topics, related details as subtopics, explicit work as grouped follow-ups,
  and evidence-backed unresolved gaps as analysis notes. Derive legacy flat
  fields in code instead of asking the model to repeat the same content.
- Raise the default uploaded-media limit to 512 MiB and return structured HTTP
  413 instead of an Express HTML 500 when that limit is exceeded.
- Retain `gpt-4o-transcribe` as the production ASR baseline. Compare Luna,
  Terra, and Sol summaries against the same transcript; use Sol for the HDD
  quality benchmark without coupling punctuation to the summary model.
- Stop injecting the optional diarization deployment into the canonical
  workflow. Preserve historical speaker metadata for artifact compatibility,
  but omit it from new provider calls, summary prompts, operator/admin readers,
  and text exports.
- Separate provider-quality benchmarks from operator-assisted terminology
  checks: provider comparisons receive no phrase list or aliases derived from
  the recording, reference transcript, or PLAUD output.

## Impact

- Affected specs:
  - `faithful-multilingual-transcription`
  - `meeting-summary-generation`
  - `media-ingestion`
- Affected code:
  - upload form and control-plane upload validation
  - recording-job persistence and transcription claims
  - Azure transcription prompt/chunk/retry/normalization and dormant
    speaker-evidence compatibility
  - content-agnostic repetitive-transcript detection at the existing sparse
    retry seam
  - historical transcript speaker-metadata compatibility without new
    classification or presentation
  - Azure Responses error handling, request audit metadata, and usage settlement
  - focused worker and control-plane tests
- Related active changes:
  - `add-faithful-multilingual-transcription` remains the raw/display evidence
    foundation.
  - `add-azure-summary-quota-fallback` supersedes the former HTTP 400 replay:
    the single reserved Azure fallback request is observable but never replayed.
  - `simplify-mai-transcription-pipeline` supersedes this change's optional
    diarization runtime; `refine-meeting-artifact-reader` supersedes its former
    speaker presentation. Historical metadata and benchmark evidence remain
    compatible but no new canonical diarization request is made.
