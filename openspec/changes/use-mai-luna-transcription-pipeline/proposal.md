# Change: Use MAI-Transcribe 1.5 with separate Luna polishing and summary

> **Historical implementation note (2026-08-06):**
> `simplify-mai-transcription-pipeline` removed Luna polishing, and
> `use-local-codex-summaries` replaces the Azure-hosted summary transport.
> MAI transcription evidence below remains valid; its active Luna routing does not.

## Why

Blind validation on the correct HDD meeting WAV showed that
`mai-transcribe-1.5` recovered the central Chinese term `舌片` far more
reliably than the current Azure transcript and produced stronger
PLAUD-relative agreement than the current Qwen default. The requested
production flow is now MAI verbatim transcription, a faithful Luna polishing
pass, and a separate Luna summary pass.

## What Changes

- Add Azure Speech `mai-transcribe-1.5` as a cloud transcription provider and
  make it the default for future claims.
- Submit up to three independent 30-second audio chunks concurrently with
  `transcribeStyle=verbatim`, without a phrase list, forced locale,
  recording-derived answer terms, or PLAUD text.
- Preserve MAI output as immutable `rawText`; run a separate
  `gpt-5.6-luna` Responses request with `reasoning.effort=max` to produce the
  guarded `displayText`.
- Run summary generation as another independent `gpt-5.6-luna` Responses
  request with `reasoning.effort=max`.
- Retry bounded MAI HTTP 400, transient transport, and existing HTTP-200
  repetitive-content failures without changing the audio or adding answer
  hints.
- Apply the same oracle-free HTTP 400 and transient-transport resilience to
  optional diarization speaker-evidence requests.
- Compare the resulting summary with PLAUD only after generation.

## Impact

- Affected specs: `transcription-provider-management`,
  `whisper-transcription-pipeline`, `faithful-multilingual-transcription`,
  `meeting-summary-generation`, `transcript-punctuation-restoration`,
  `cloud-usage-governance`, `deployment-readiness`
- Affected code: control-plane provider policy, transcription worker MAI
  adapter, Responses request options, transcript polishing, Compose
  configuration, tests, and operator documentation
- Runtime: MAI and both Luna stages are cloud-billable and remain unpriced
  until an authoritative model/version meter is configured
