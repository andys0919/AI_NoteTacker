# Project Context

## Purpose
Build a self-hosted meeting recording and transcription platform that can join supported meetings through direct meeting links, record audio/video inside isolated workers, and produce Whisper-based transcripts without relying on the user's workstation audio stack.

The current product focus is still operational reliability for recording and transcript generation, but the repository now also includes Codex summaries, structured action items/decisions/risks/open questions, archive search/export, and operator controls needed to make the system usable day to day.

## Tech Stack
- OpenSpec for change proposals, design docs, and requirement tracking
- TypeScript and Node.js for control-plane APIs and browser automation orchestration
- Playwright + Chromium for browser-based meeting join flows
- Docker for worker isolation and deployment
- FFmpeg, Xvfb, and PulseAudio for isolated media capture where browser-native capture is insufficient
- Whisper-based transcription, with `faster-whisper` as the expected implementation target
- Object storage compatible with S3/MinIO for recording artifacts
- PostgreSQL for job metadata and transcript indexing
- Redis for queueing and worker dispatch when concurrent processing is introduced

## Project Conventions

### Code Style
- Prefer TypeScript for orchestration and API-facing services.
- Use explicit, domain-specific names such as `RecordingJob`, `MeetingJoinPolicy`, and `TranscriptArtifact`.
- Keep modules focused; avoid generic `utils` or `helpers` dumping grounds.
- Default to ASCII in files unless a non-ASCII character is already established and justified.

### Architecture Patterns
- Separate control plane from worker plane.
- Treat meeting capture as infrastructure isolated from business logic.
- Model work as explicit job lifecycle transitions: `queued`, `joining`, `recording`, `transcribing`, `completed`, `failed`.
- Store original recording artifacts separately from derived transcript artifacts.
- Fail fast for unsupported meeting access patterns instead of partially automating login or SSO flows.

### Testing Strategy
- Validate meeting URL parsing and support-matrix decisions with unit tests.
- Validate worker lifecycle transitions with integration tests.
- Use end-to-end smoke tests against disposable guest-access meetings where feasible.
- Test Whisper transcription deterministically using canned recordings.
- Treat OpenSpec requirement scenarios as the acceptance test source of truth.

### Git Workflow
- Use small, reviewable changes aligned to OpenSpec change proposals.
- Keep specs and design documents updated before implementation claims.
- Do not mark work complete until the relevant OpenSpec change validates and key flows are verified.

## Domain Context
- The product is a meeting bot platform, not a desktop recorder.
- The system must join meetings using direct links when guest or anonymous join is permitted.
- The user's workstation must remain uninvolved in media capture after a job is submitted.
- The current product already includes summaries, structured summary sections, archive search, export, interrupt/stop controls, and authenticated operator ownership. Speaker diarization, CRM integrations, and richer multi-worker scheduling can be added later.
- Platform constraints matter: some Zoom, Meet, and Teams meetings cannot be joined without authentication, approval, or manual admission.

## Important Constraints
- No capture path may depend on the submitting user's live system audio device.
- The MVP must not require storing or using the user's personal Google, Microsoft, or Zoom credentials.
- Transcription must use Whisper only; no hosted STT vendors in the MVP.
- The system must prefer self-hosted infrastructure and locally controlled artifacts.
- Unsupported meetings must surface clear failure reasons instead of hanging indefinitely.

## External Dependencies
- Google Meet, Microsoft Teams, and Zoom web meeting flows
- Chromium / Playwright runtime
- Whisper model weights and runtime dependencies
- S3-compatible object storage such as MinIO
- PostgreSQL and optionally Redis
- A fork or derivative of `screenappai/meeting-bot` as the likely browser automation foundation
