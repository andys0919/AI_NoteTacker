# Transcription Worker

The transcription worker handles uploaded-media and completed recording artifacts after they are ready for transcription.

## Current Behavior

- downloads the source artifact
- prepares canonical audio with FFmpeg when needed
- runs Whisper transcription
- optionally runs Codex summary generation
- posts transcript and summary artifacts back to the control plane

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

## Run

```bash
docker compose up -d --build transcription-worker
```

## Validate

```bash
python3 scripts/run_transcription_worker_tests.py
python3 scripts/compile_transcription_worker.py
```
