## Context

The worker already owns the hard parts of transcription: prepared WAV input,
bounded upload plans, immutable raw/display evidence, Traditional Chinese
normalization, HTTP-200 repetition detection, retry, progress, cancellation,
usage reporting, and optional speaker alignment. Qwen3-ASR exposes an
OpenAI-compatible `/v1/audio/transcriptions` endpoint but returns internal
`language ...<asr_text>` markers in its text field and was empirically stable
with 60-second chunks on the target GPU.

The earlier quality change correctly withheld a production recommendation
because the HDD recording has no authoritative word-level reference and Qwen
did not recover every visible term. This change records the operator's explicit
rollout decision; it does not relabel the earlier evidence as proof that Qwen is
universally more accurate.

## Goals / Non-Goals

- Goals:
  - make Qwen3-ASR 1.7B the primary provider for future claims;
  - preserve current transcript evidence and content-quality safeguards;
  - retain Azure diarization only as independently aligned speaker evidence;
  - produce an oracle-free historical Qwen-versus-Azure comparison.
- Non-Goals:
  - infer correct terminology from Azure, PLAUD, filenames, or expected answers;
  - ensemble or silently fall back between provider transcript texts;
  - fine-tune Qwen or add a phrase-list subsystem;
  - rewrite historical stored transcript artifacts.

## Decisions

### Reuse the existing transcriber seam

Qwen extends the existing Azure/OpenAI-compatible transcriber implementation.
The shared implementation keeps segmentation, raw/display normalization,
quality retry, cleanup, progress, cancellation, and diarization. The Qwen
adapter only supplies its endpoint contract, 60-second boundary, protocol
marker cleanup, and language mapping.

### Keep Qwen recognition unassisted by comparison answers

Historical evaluation submits only the original audio and generic provider
configuration. Qwen requests omit the `prompt` field entirely, including job
glossary and previous-model transcript text. Stored Azure text and any external
transcript are comparison outputs only. Existing operator-verified job aliases
may remain traceable post-ASR display evidence when explicitly present on a new
job, but cannot alter Qwen provider raw text and are not manufactured from a
benchmark answer.

### Keep speaker evidence independent

When Azure diarization is configured, it runs beside Qwen and may attach only
alignment-gated anonymous speaker labels. It cannot replace Qwen `rawText`,
`displayText`, or `text`. A diarization failure does not invalidate valid Qwen
primary text.

### Use an explicit provider and model identity

The provider is `qwen3-asr-1.7b`; the configured served model defaults to the
same value. It is a local provider for scheduling and cloud-quota purposes.
Azure and Whisper remain selectable, and provider latching prevents a settings
change from altering in-flight or completed work.

### Deploy one official Qwen service

Compose runs the official Qwen3-ASR image with the already validated target
settings: model `Qwen/Qwen3-ASR-1.7B`, 8192 maximum model length, one sequence,
40 percent GPU-memory utilization, and eager execution. The transcription
worker waits for its health check and calls it over the internal Compose
network.

## Risks / Trade-offs

- Qwen may still misrecognize domain terminology. Mitigation: preserve raw
  evidence, report blind historical differences, and keep explicit Azure and
  Whisper rollback choices.
- Qwen and Whisper share the GPU host. Mitigation: keep local transcription
  concurrency at one and validate live GPU headroom after deployment.
- Similarity between two ASR outputs does not identify the correct one.
  Mitigation: report agreement, repetition, language, length, and sampled
  differences separately; label accuracy unknown where no human reference
  exists.
- The Qwen API may return repeated protocol markers inside one response.
  Mitigation: deterministically remove every recognized marker before
  normalization and cover it with a focused parser test.

## Migration Plan

1. Add and validate the provider contract and worker adapter.
2. Add the Compose service and rebuild the control plane and transcription
   worker.
3. Verify Qwen health and a real worker transcription path.
4. Persist `qwen3-asr-1.7b` as the global provider/model for future claims.
5. Run the historical comparison and record results.

Rollback is an admin policy switch back to
`azure-openai-gpt-4o-transcribe`; existing Qwen claims remain latched and are
not silently changed.
