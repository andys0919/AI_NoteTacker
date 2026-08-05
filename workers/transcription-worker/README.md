# Transcription and Summary Workers

The worker Dockerfile exposes separate `transcription` and `summary` targets.
They share source code, but each image contains only the packages its process
uses.

## Current Behavior

- downloads the source artifact
- prepares canonical audio with FFmpeg when needed
- runs Whisper transcription
- can run Azure Speech `mai-transcribe-1.5` as the primary provider
  - sends up to three independent 30-second chunks concurrently with
    `transcribeStyle=verbatim`, then restores timestamp order
  - omits phrase lists, forced locale, and comparison answers
  - retries one identical HTTP 400; transient transport failures retry after
    2, 10, and 30 seconds; reuses the bounded HTTP-200 repetitive-content gate
  - preserves MAI provider text as immutable `rawText`
  - when MAI reports Chinese, converts only `displayText` to Traditional
    Chinese and normalizes the segment language to `zh-Hant`
  - does not call transcript polishing or speaker diarization
- can run self-hosted Qwen3-ASR 1.7B as the primary provider through its
  OpenAI-compatible API
  - uses 60-second chunks and removes every Qwen `language ...<asr_text>`
    protocol marker before preserving provider wording as raw evidence
  - reuses the existing repetition/content retry, Traditional Chinese display
    normalization, progress, and cancellation flow
- can alternatively run Azure OpenAI `gpt-4o-transcribe` when the claimed job is latched to that provider
  - sends a multilingual preservation prompt plus workflow-specific verified terminology; it does not ask the provider to translate non-Chinese speech
  - splits long recordings into five-minute uploads with an 800-character preceding-context tail; an audible sparse span is replayed at most twice, while an HTTP 200 span of at least 20 seconds with gzip ratio over 4.0 is replayed from the same audio in at-most-30-second chunks without preceding generated-text context; persistently invalid text fails instead of being stored
  - keeps provider output as immutable raw evidence, converts only confidently Chinese display text to Traditional Chinese, and attaches non-authoritative review candidates for uncertain high-risk terms
- the separate summary process can run local Codex or Azure OpenAI based on the claimed job snapshot
- the summary process claims work from its own control-plane queue so local/cloud summary pools stay separate
- posts transcript or summary artifacts back to the control plane from the responsible process
- includes speech-to-text and summary usage metadata in callbacks for idempotent cloud-cost settlement
- sends summary Azure Responses requests with `store: false` and
  `reasoning.effort=high`; they use 900-second socket-operation timeouts by
  default
- uses a 300-second socket-operation timeout for Azure transcription uploads and a 30-second timeout for control-plane GET/POST calls by default
- rejects Azure summaries unless `title` and `summary` are non-empty strings;
  `topics`, `follow_up_groups`, `decisions`, `risks`, `open_questions`, and
  `analysis_notes` are arrays; each topic has a title, status, non-empty
  subtopics, and conclusion; and each follow-up group has a title and non-empty
  items. Compatibility `key_points` and `action_items` are derived from the
  hierarchy; valid Azure token usage is retained when schema validation fails
- fails Azure summary jobs on missing usage or non-completed Responses results
- concatenates ordered `output_text` fragments exactly and trims only the final aggregate, so a structured payload is never changed by inserted separators
- performs no hidden Responses transport retry; summary replays HTTP 400 once
  with the identical request and marks the failed attempt unmetered; an
  identical terminal control-plane callback may be resent once without
  repeating provider work

## Defaults

Current expected runtime:

- `WHISPER_MODEL=tiny`
- `WHISPER_DEVICE=cuda`
- `WHISPER_COMPUTE_TYPE=float16`
- `MAX_CONCURRENT_TRANSCRIPTION_JOBS=1`

That means:
- one shared GPU transcription slot by default
- later upload jobs queue instead of oversubscribing the GPU

## Environment

Shared variables:

- `CONTROL_PLANE_BASE_URL`
- `CONTROL_PLANE_TIMEOUT_SECONDS` (positive integer socket-operation timeout; default `30`)
- `WORKER_ID`

Transcription process:

- `WHISPER_MODEL`
- `WHISPER_DEVICE`
- `WHISPER_COMPUTE_TYPE`
- self-hosted Qwen:
  - `QWEN_ASR_ENDPOINT` (default Compose service:
    `http://qwen3-asr:8000`)
  - `QWEN_ASR_MODEL` (default `qwen3-asr-1.7b`)
  - `QWEN_ASR_TIMEOUT_SECONDS` (default `300`)
- Azure Speech MAI:
  - `AZURE_SPEECH_MAI_ENDPOINT`
  - `AZURE_SPEECH_MAI_MODEL` (default `mai-transcribe-1.5`)
  - `AZURE_SPEECH_MAI_API_KEY`
  - `AZURE_SPEECH_MAI_API_VERSION` (default `2025-10-15`)
  - `AZURE_SPEECH_MAI_TIMEOUT_SECONDS` (default `300`)
- optional Azure hosted transcription:
  - `AZURE_OPENAI_ENDPOINT`
  - `AZURE_OPENAI_DEPLOYMENT`
  - `AZURE_OPENAI_API_KEY`
  - `AZURE_OPENAI_API_VERSION`
  - `AZURE_OPENAI_TRANSCRIBE_TIMEOUT_SECONDS` (positive integer socket-operation timeout; default `300`)
  - `AZURE_OPENAI_TRANSCRIBE_LANGUAGE` (BCP-47 hint, e.g. `zh`; blank = auto-detect)
  - `AZURE_OPENAI_TRANSCRIBE_PROMPT` (recognition hint; blank = built-in preserve-language + Traditional-Chinese-display policy)

Summary process:

- `SUMMARY_MODEL`
- `SUMMARY_REASONING_EFFORT`
- `CODEX_CLI_PATH`
- `CODEX_HOME`
- optional Azure hosted summary:
  - `AZURE_OPENAI_SUMMARY_ENDPOINT` (explicit HTTPS URL whose normalized path is exactly `/openai/v1/responses`)
  - `AZURE_OPENAI_SUMMARY_API_KEY`
  - `AZURE_OPENAI_SUMMARY_TIMEOUT_SECONDS` (positive integer socket-operation timeout; default `900`)

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
- each stage claim returns the effective job snapshot for that job
- the transcription process uses `transcriptionProvider`
- the summary process uses `summaryProvider`
- once claimed or submitted, the job keeps that routing even if the admin switches future defaults later
- summary generation begins only after the summary process claims the job

## Run

Production uses the canonical base plus screenapp Compose files:

```bash
./scripts/deploy.sh up
```

For local upload-only development, the worker can be rebuilt directly:

```bash
docker compose up -d --build transcription-worker
```

Worker source is baked into the image; code changes require a rebuild and
container recreation rather than only a process restart.

## Validate

```bash
npm run test:python
npm run build:python
```
