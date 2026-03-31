# meeting-ai-pipeline

Reusable Python package for:

- downloading meeting artifacts from URL or S3-compatible storage
- GPU Whisper transcription via `faster-whisper`
- Codex transcript summarization
- end-to-end transcript + summary pipeline orchestration

## Install

From this repository:

```bash
pip install -e /home/solomon/Andy/AI_NoteTacker/packages/meeting-ai-pipeline
```

If you do not want editable mode:

```bash
pip install /home/solomon/Andy/AI_NoteTacker/packages/meeting-ai-pipeline
```

## Requirements

- Python `3.12+`
- For GPU Whisper:
  - NVIDIA GPU
  - CUDA-visible runtime
  - `faster-whisper` runtime dependencies
- For Codex summary:
  - `codex` CLI installed and available in `PATH`
  - authenticated Codex session via `CODEX_HOME` or equivalent host auth mount

## Minimal Example

```python
from meeting_ai_pipeline import (
    CodexTranscriptSummarizer,
    FasterWhisperTranscriber,
    RecordingArtifactDownloader,
    S3ArtifactStorage,
    run_meeting_ai_pipeline,
)

storage = S3ArtifactStorage(
    bucket_name="meeting-artifacts",
    endpoint_url="http://minio:9000",
    region_name="us-east-1",
    access_key_id="minioadmin",
    secret_access_key="minioadmin",
)

downloader = RecordingArtifactDownloader(object_storage=storage)
transcriber = FasterWhisperTranscriber(
    model_name="large-v3",
    device="cuda",
    compute_type="float16",
)
summarizer = CodexTranscriptSummarizer(
    model="gpt-5.3-codex-spark",
    reasoning_effort="medium",
    codex_cli_path="codex",
)

result = run_meeting_ai_pipeline(
    recording_artifact={
        "storageKey": "meeting-bot/example.webm",
        "downloadUrl": "http://minio:9000/meeting-artifacts/meeting-bot/example.webm",
        "contentType": "video/webm",
    },
    downloader=downloader,
    transcriber=transcriber,
    summarizer=summarizer,
)

print(result["transcript"]["language"])
print(result["summary"]["text"])
```

## Transcript Only

If another project only wants Whisper transcription:

```python
from meeting_ai_pipeline import (
    FasterWhisperTranscriber,
    RecordingArtifactDownloader,
    run_meeting_ai_pipeline,
)

result = run_meeting_ai_pipeline(
    recording_artifact=artifact,
    downloader=downloader,
    transcriber=transcriber,
    summarizer=None,
)
```

## Output Shape

`run_meeting_ai_pipeline(...)` returns:

```python
{
    "local_audio_path": "/tmp/...",
    "transcript": {
        "language": "zh",
        "segments": [...],
    },
    "summary": {
        "model": "gpt-5.3-codex-spark",
        "reasoning_effort": "medium",
        "text": "## Summary ...",
    } | None,
}
```

## Docker Notes

If you run this inside Docker and want the same behavior as this repository:

- expose the GPU to the container
- set Whisper to `device=cuda`, `compute_type=float16`
- mount host `CODEX_HOME` into the container if you want Codex summary
- ensure `codex` CLI is installed inside the image

Reference implementation in this repo:

- [docker-compose.screenapp.yml](/home/solomon/Andy/AI_NoteTacker/docker-compose.screenapp.yml)
- [workers/transcription-worker/Dockerfile](/home/solomon/Andy/AI_NoteTacker/workers/transcription-worker/Dockerfile)
