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
- the separate summary process sends the existing prompt to AI_NoteTacker's
  dedicated shared-runtime `codex-pty-agent` over authenticated `/api/prompt`
- the summary process claims work from its own local summary pool
- posts transcript or summary artifacts back to the control plane from the responsible process
- stores every provider request start before contacting the provider and
  finalizes the same audit row with outcome, external request ID, usage, and
  pricing evidence; terminal callbacks reference those request IDs
- runs `gpt-5.6-luna` with effort `max` in a fresh Codex PTY session with
  memory disabled and an empty working directory
- uses a 300-second socket-operation timeout for Azure transcription uploads and a 30-second timeout for control-plane GET/POST calls by default
- rejects summaries unless `title` and `summary` are non-empty strings;
  `topics`, `follow_up_groups`, `decisions`, `risks`, `open_questions`, and
  `analysis_notes` are arrays; each topic has a title, status, non-empty
  subtopics, and conclusion; and each follow-up group has a title and non-empty
  items. Compatibility `key_points` and `action_items` are derived from the hierarchy
- may resend an identical terminal control-plane callback once without repeating model work

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
- `SUMMARY_TIMEOUT_SECONDS` (positive Prompt API wall-clock timeout; default `900`)
- `CODEX_PTY_API_URL` (canonical internal URL:
  `http://codex-pty-agent:3001/api/prompt`)
- `CODEX_PTY_API_TOKEN` (dedicated secret of at least 32 bytes)
- `CODEX_CLI_PATH` and `CODEX_HOME` only for the structured weekly-quota probe;
  summary generation does not invoke `codex exec`
- retained `AZURE_OPENAI_SUMMARY_ENDPOINT` and
  `AZURE_OPENAI_SUMMARY_API_KEY` settings; canonical production Compose injects
  empty values and therefore cannot activate the fallback
- `AZURE_OPENAI_SUMMARY_TIMEOUT_SECONDS` (default `900`)

The `codex-pty-agent` keeps its protected ChatGPT login and writable runtime
state in bot-specific volumes. The summary worker has a separate protected
`CODEX_HOME` only for `account/rateLimits/read`. Do not paste OAuth tokens into
application settings or Compose variables. Subscription summaries are audited
with their token usage but are not reported as metered API spend. Canonical
production injects empty Azure summary credentials, so Prompt API, PTY,
authentication, quota, timeout, and schema failures fail explicitly without an
Azure request.

## Provider Selection

The worker does not choose the provider by itself.

- the control-plane snapshots transcription and summary routing onto the job at submission time
- each stage claim returns the effective job snapshot for that job
- the transcription process uses `transcriptionProvider`
- the summary process accepts only `summaryProvider=local-codex` as the primary route
- Azure remains an internal quota-only fallback implementation, not a
  job/provider selection; canonical production disables it with empty credentials
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
