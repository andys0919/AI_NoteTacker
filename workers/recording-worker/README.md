# Recording Worker

The recording worker polls the control plane for meeting-link jobs and hands them to a recording executor.

## Current Executors

- `stub`
  - test and local skeleton mode
  - simulates recording + artifact callbacks
- `screenapp`
  - dispatches a real meeting-bot runtime
  - intended for direct-link meeting recording

## Environment

Important variables:

- `CONTROL_PLANE_BASE_URL`
- `WORKER_ID`
- `RECORDING_EXECUTOR`
- `MEETING_BOT_BASE_URL`
- `MEETING_BOT_BEARER_TOKEN`
- `MEETING_BOT_BOT_NAME`
- `MEETING_BOT_TEAM_ID`
- `MEETING_BOT_TIMEZONE`
- `MEETING_BOT_USER_ID`

## Behavior

- claims only queued `meeting-link` jobs
- respects the single shared meeting-bot runtime gate
- posts lifecycle events back to the control plane
- leaves uploaded-media jobs to the transcription worker

## Run

Normally started by Docker Compose:

```bash
docker compose up -d --build recording-worker
```

For real meeting-bot runs, use:

```bash
docker compose -f docker-compose.yml -f docker-compose.screenapp.yml up -d --build recording-worker meeting-bot
```
