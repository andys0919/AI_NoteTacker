## Why

Existing AI note-taking products often depend on hosted SaaS bots or on local desktop capture, both of which conflict with the target deployment model. This project needs a self-hosted, autonomous meeting recorder that joins supported meetings through a direct link, records inside an isolated worker, and produces Whisper-based transcripts without consuming the user's workstation audio environment.

## What Changes

- Add a meeting recording job model that accepts direct meeting links and exposes clear lifecycle states.
- Add isolated recording workers that join supported meetings as guest or anonymous participants where the platform allows it.
- Add artifact persistence for original recordings and derived transcript outputs.
- Add a Whisper-only transcription pipeline that runs on recorded meeting audio.
- Add explicit support-matrix validation so unsupported meetings fail early with actionable reasons.

## Capabilities

### New Capabilities
- `recording-job-management`: Submit recording jobs, validate support, and expose status and artifact retrieval.
- `isolated-meeting-recording`: Join supported meetings in dedicated workers and capture meeting media without using the user's workstation audio stack.
- `whisper-transcription-pipeline`: Produce transcripts from stored recordings using self-hosted Whisper-based transcription.

### Modified Capabilities
- None.

## Impact

- Introduces a control-plane API, recording workers, transcription workers, and artifact storage.
- Establishes Docker-based deployment and worker isolation as a foundational architecture choice.
- Adds Whisper runtime requirements, recording retention concerns, and platform-specific failure handling.
- Uses a `screenappai/meeting-bot` style browser automation base instead of captions-only or desktop-capture approaches.
