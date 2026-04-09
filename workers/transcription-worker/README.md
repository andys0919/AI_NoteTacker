# Transcription Worker

The transcription worker handles uploaded-media and completed recording artifacts after they are ready for transcription.

## Current Behavior

- downloads the source artifact
- prepares canonical audio with FFmpeg when needed
- runs Whisper transcription
- can alternatively run Azure OpenAI `gpt-4o-mini-transcribe` when the claimed job is latched to that provider
- can run summary generation through local Codex or Azure OpenAI based on the claimed job snapshot
- waits for a control-plane summary slot before beginning summary generation so local/cloud summary pools stay separate
- posts transcript and summary artifacts back to the control plane
- includes stage usage metadata in transcript and summary callbacks for cloud cost settlement

## Defaults

Current expected runtime:

- `WHISPER_MODEL=large-v3`
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
- optional Azure hosted summary:
  - `AZURE_OPENAI_SUMMARY_ENDPOINT`
  - `AZURE_OPENAI_SUMMARY_API_KEY`

## Provider Selection

The worker does not choose the provider by itself.

- the control-plane snapshots transcription and summary routing onto the job at submission time
- each transcription claim returns the effective job snapshot for that job
- the worker uses `transcriptionProvider` for transcript generation
- the worker uses `summaryProvider` for summary generation
- once claimed or submitted, the job keeps that routing even if the admin switches future defaults later
- summary generation begins only after the worker successfully claims a summary slot from the control plane

## Run

```bash
docker compose up -d --build transcription-worker
```

## Validate

```bash
python3 scripts/run_transcription_worker_tests.py
python3 scripts/compile_transcription_worker.py
```
