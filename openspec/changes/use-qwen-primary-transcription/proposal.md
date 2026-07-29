# Change: Use Qwen3-ASR as the primary transcription provider

## Why

The current Azure primary transcript has produced repeated HTTP-200 content
failures and materially wrong Chinese terminology on real meetings. A completed
blind run of Qwen3-ASR 1.7B removed the worst repetition artifact and the
operator has explicitly chosen Qwen for new transcription work, while retaining
Azure diarization as independent speaker evidence.

## What Changes

- Add `qwen3-asr-1.7b` as an approved local transcription provider.
- Route new transcription claims to a self-hosted Qwen OpenAI-compatible API by
  default; existing claimed/completed jobs keep their latched provider.
- Reuse the current transcript evidence, Traditional Chinese display
  normalization, quality retry, progress, cancellation, and optional Azure
  diarization flow.
- Use fixed 60-second Qwen chunks and remove Qwen protocol markers before text
  normalization.
- Keep Azure transcription and Whisper as explicit operator-selectable
  fallbacks; do not silently mix their text into a Qwen transcript.
- Compare Qwen against stored Azure results on multiple historical recordings
  without supplying Azure text, PLAUD text, or recording-derived answer terms
  to Qwen.

## Impact

- Affected specs: `whisper-transcription-pipeline`,
  `transcription-provider-management`, `faithful-multilingual-transcription`,
  `deployment-readiness`
- Affected code: control-plane provider catalog and policy model selection,
  transcription worker provider registry, Qwen adapter, Compose deployment, and
  focused provider tests
- Runtime: one additional GPU service using the official Qwen3-ASR image; local
  transcription concurrency remains one
