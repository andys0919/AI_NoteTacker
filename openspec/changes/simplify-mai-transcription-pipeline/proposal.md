# Change: Simplify MAI transcription to deterministic Traditional Chinese

> **Summary-route update (2026-08-06):**
> `use-local-codex-summaries` keeps this MAI transcription design but replaces
> the Azure-hosted Luna summary request with local Codex.

## Why

`mai-transcribe-1.5` already provides the canonical transcript. Sending that
transcript through Luna again adds latency and cost, while diarization adds
speaker evidence the product no longer wants to display. The requested
production flow is therefore MAI transcription, deterministic Traditional
Chinese display normalization, and one independent Luna max summary request.

## What Changes

- Stop transcript-polishing and diarization requests from the transcription
  worker.
- Preserve MAI provider text as immutable `rawText`.
- When MAI reports a Chinese locale, normalize only `displayText` to
  Traditional Chinese with the existing deterministic converter.
- Keep `gpt-5.6-luna` with `reasoning.effort=max` only in the summary worker.
- Remove Luna summary credentials and transcript-polishing settings from the
  transcription-worker runtime.

## Impact

- Affected specs: `faithful-multilingual-transcription`,
  `meeting-summary-generation`, `transcript-punctuation-restoration`,
  `deployment-readiness`
- Affected code: transcription-worker composition/configuration, Compose
  environment, focused tests, and operator documentation
- Runtime: one MAI transcription stage plus one separately metered Luna summary
  stage; no new punctuation-polishing or diarization usage
