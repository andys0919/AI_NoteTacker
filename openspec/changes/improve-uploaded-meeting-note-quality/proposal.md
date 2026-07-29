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
- Retry an Azure summary HTTP 400 exactly once with the identical payload,
  preserve the final Azure error body, and record provider/unmetered request
  counts when usage is available.
- Feed operator-verified display terminology to summaries without relabelling
  it as unconfirmed, and keep tentative or later-to-be-confirmed points out of
  `decisions`.
- Raise the default uploaded-media limit to 512 MiB and return structured HTTP
  413 instead of an Express HTML 500 when that limit is exceeded.
- Retain `gpt-4o-transcribe` as the production ASR baseline. Compare Luna,
  Terra, and Sol summaries against the same transcript; use Sol for the HDD
  quality benchmark without coupling punctuation to the summary model.
- Add an opt-in hybrid speaker-attribution path: keep `gpt-4o-transcribe` as
  the only text authority, use lossless `gpt-4o-transcribe-diarize` output only
  as speaker/timing evidence, bootstrap up to four anonymous speaker
  references from the first two chunks, carry them across later chunks, and
  omit a speaker when deterministic text alignment fails.
- Retry the observed transient diarization `404 DeploymentNotFound` once with
  the identical request, requeue a still-failed chunk once after the batch,
  keep diarization failures non-destructive to the primary transcript, and
  account for the second model separately as unpriced transcription-stage
  usage.
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
  - Azure transcription prompt/chunk/retry/normalization and speaker-evidence
    alignment logic
  - content-agnostic repetitive-transcript detection at the existing sparse
    retry seam
  - additive transcript speaker metadata, rendering, export, and usage
    settlement
  - Azure Responses error handling, summary retry metadata, and usage settlement
  - focused worker and control-plane tests
- Related active changes:
  - `add-faithful-multilingual-transcription` remains the raw/display evidence
    foundation.
  - `update-cloud-summary-azure-responses` is amended so its former global
    no-provider-retry rule permits only the bounded summary HTTP 400 exception
    defined here.
