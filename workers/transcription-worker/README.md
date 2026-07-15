# Transcription Worker

The transcription worker handles uploaded-media and completed recording artifacts after they are ready for transcription.

## Current Behavior

- downloads the source artifact
- prepares canonical audio with FFmpeg when needed
- runs Whisper transcription
- can alternatively run Azure OpenAI `gpt-4o-transcribe` when the claimed job is latched to that provider
  - sends a multilingual preservation prompt plus workflow-specific verified terminology; it does not ask the provider to translate non-Chinese speech
  - keeps provider output as immutable raw evidence, converts only confidently Chinese display text to Traditional Chinese, and attaches non-authoritative review candidates for uncertain high-risk terms
  - restores punctuation through the Azure Responses API (`gpt-4o-transcribe` may return text without the desired punctuation and `prompt` cannot reliably force it) under a strict fidelity guard — the rewrite is only accepted when it adds nothing but punctuation/whitespace, otherwise the raw text is kept, so a flaky/hallucinating call never corrupts or fails the transcript
  - splits the punctuated text into one segment per sentence (gpt-4o-transcribe has no native segmentation)
- can run summary generation through local Codex or Azure OpenAI based on the claimed job snapshot
- waits for a control-plane summary slot before beginning summary generation so local/cloud summary pools stay separate
- posts transcript and summary artifacts back to the control plane
- includes speech-to-text, punctuation, and summary usage metadata in callbacks for idempotent cloud-cost settlement
- sends Azure Responses requests with `store: false`, which disables Responses application-state/message-history storage but is not by itself a zero-data-retention guarantee; summary and punctuation calls use 300-second and 30-second socket-operation timeouts by default
- uses a 300-second socket-operation timeout for Azure transcription uploads and a 30-second timeout for control-plane GET/POST calls by default
- rejects Azure summaries unless `summary` is a non-empty string and all five collection fields are string arrays (empty arrays are valid); valid Azure token usage is retained when this validation fails
- fails Azure summary jobs on missing usage or non-completed Responses results; punctuation remains best-effort and reports aggregate fallback/unmetered counts while preserving raw text
- concatenates ordered `output_text` fragments exactly and trims only the final aggregate, so a structured payload is never changed by inserted separators
- performs no hidden Responses provider retry; a punctuation transport failure falls back to raw text, while a summary transport failure is reported to the scheduler; an identical terminal control-plane callback may be resent once without repeating the provider call

## Defaults

Current expected runtime:

- `WHISPER_MODEL=tiny`
- `WHISPER_DEVICE=cuda`
- `WHISPER_COMPUTE_TYPE=float16`
- `SUMMARY_ENABLED=true`
- `MAX_CONCURRENT_TRANSCRIPTION_JOBS=1`

That means:
- one shared GPU transcription slot by default
- later upload jobs queue instead of oversubscribing the GPU

## Environment

Important variables:

- `CONTROL_PLANE_BASE_URL`
- `CONTROL_PLANE_TIMEOUT_SECONDS` (positive integer socket-operation timeout; default `30`)
- `WORKER_ID`
- `WHISPER_MODEL`
- `WHISPER_DEVICE`
- `WHISPER_COMPUTE_TYPE`
- `SUMMARY_ENABLED`
- `SUMMARY_MODEL`
- `SUMMARY_REASONING_EFFORT`
- `CODEX_CLI_PATH`
- `CODEX_HOME`
- optional Azure hosted transcription:
  - `AZURE_OPENAI_ENDPOINT`
  - `AZURE_OPENAI_DEPLOYMENT`
  - `AZURE_OPENAI_API_KEY`
  - `AZURE_OPENAI_API_VERSION`
  - `AZURE_OPENAI_TRANSCRIBE_TIMEOUT_SECONDS` (positive integer socket-operation timeout; default `300`)
  - `AZURE_OPENAI_TRANSCRIBE_LANGUAGE` (BCP-47 hint, e.g. `zh`; blank = auto-detect)
  - `AZURE_OPENAI_TRANSCRIBE_PROMPT` (recognition hint; blank = built-in preserve-language + Traditional-Chinese-display policy)
  - `TRANSCRIPT_PUNCTUATION_ENABLED` (default `true`; set `false` to keep raw unpunctuated text)
  - `AZURE_OPENAI_PUNCTUATION_MODEL` (Responses model for punctuation restore; blank = reuse `SUMMARY_MODEL`; uses the summary endpoint/key)
  - `AZURE_OPENAI_PUNCTUATION_TIMEOUT_SECONDS` (positive integer socket-operation timeout; default `30`)
- optional Azure hosted summary:
  - `AZURE_OPENAI_SUMMARY_ENDPOINT` (explicit HTTPS URL whose normalized path is exactly `/openai/v1/responses`)
  - `AZURE_OPENAI_SUMMARY_API_KEY`
  - `AZURE_OPENAI_SUMMARY_TIMEOUT_SECONDS` (positive integer socket-operation timeout; default `300`)

The summary endpoint and key are deliberately not inferred from the transcription
endpoint/key. Azure summary readiness requires both explicit values, because the
speech-to-text endpoint and the Responses endpoint are different contracts.

Token callbacks distinguish total input/output tokens from cached-input and
reasoning-output subsets. USD is calculated only when the configured model and
pricing version have an authoritative catalog entry. Unknown models remain
`unpriced`; they are never reported as zero-cost usage.

## Provider Selection

The worker does not choose the provider by itself.

- the control-plane snapshots transcription and summary routing onto the job at submission time
- each transcription claim returns the effective job snapshot for that job
- the worker uses `transcriptionProvider` for transcript generation
- the worker uses `summaryProvider` for summary generation
- once claimed or submitted, the job keeps that routing even if the admin switches future defaults later
- summary generation begins only after the worker successfully claims a summary slot from the control plane

## Run

Production uses the canonical base plus screenapp Compose files:

```bash
make deploy
```

For local upload-only development, the worker can be rebuilt directly:

```bash
docker compose up -d --build transcription-worker
```

Worker source is baked into the image; code changes require a rebuild and
container recreation rather than only a process restart.

## Validate

```bash
python3 scripts/run_transcription_worker_tests.py
python3 scripts/compile_transcription_worker.py
```
