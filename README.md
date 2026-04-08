# AI NoteTacker

Self-hosted meeting recorder and transcription console.

This project lets an operator:
- submit a direct meeting link so an AI bot joins and records inside a container
- upload audio or video files for Whisper transcription
- read full transcripts and Codex summaries in the dashboard
- export completed jobs as Markdown, TXT, SRT, or JSON
- stop a live meeting bot or interrupt an upload/transcription job

## What Works

- Operator dashboard at `http://localhost:3000`
- Meeting-link jobs for supported guest-access links
- Uploaded audio and video transcription
- GPU Whisper transcription with `large-v3` by default
- Codex summary generation with structured sections:
  - Action Items
  - Decisions
  - Risks
  - Open Questions
- Archive search, history timeline, and export
- Email notifications for completed or failed authenticated jobs when SMTP is configured

## Prerequisites

- Docker and Docker Compose
- NVIDIA driver + `nvidia-smi` if you want GPU transcription
- `CODEX_HOME` on the host if you want Codex summaries inside the transcription worker
- Optional:
  - Supabase project for email OTP auth
  - SMTP provider for notification emails

## Start

For upload-only workflows:

```bash
docker compose up -d --build
```

For full meeting-bot workflows:

```bash
docker compose -f docker-compose.yml -f docker-compose.screenapp.yml up -d --build
```

Open:

```text
http://localhost:3000
```

## Use The Dashboard

### Submit Meeting Link

1. Paste a supported direct meeting link.
2. Keep at least one real participant in the meeting.
3. Wait for the `AI Bot` section to change from joining to recording.
4. If you want the bot to leave and keep the partial recording, click `Exit Meeting`.

Notes:
- Meeting-link jobs are effectively single-slot because there is one shared meeting-bot runtime.
- `Exit Meeting` now asks the bot to finalize the current recording before transcription when possible.

### Upload Recording

1. Drop an audio or video file into the upload card.
2. The dashboard will show `Preparing Media`, `Transcribing Audio`, and `Generating Summary`.
3. If you no longer want the job, click `Interrupt Job`.

Notes:
- Uploaded jobs share the transcription queue.
- `MAX_CONCURRENT_TRANSCRIPTION_JOBS=1` by default, so later jobs queue instead of oversubscribing the GPU.

### Read Results

Completed jobs can show:
- Full Transcript
- Codex Summary
- structured summary sections
- Job Timeline
- export buttons

### Export

Completed jobs support:
- `Export MD`
- `Export TXT`
- `Export SRT`
- `Export JSON`

## Current Runtime Defaults

Important defaults from [`.env.example`](/home/solomon/Andy/AI_NoteTacker/.env.example):

- `WHISPER_MODEL=large-v3`
- `WHISPER_DEVICE=cuda`
- `WHISPER_COMPUTE_TYPE=float16`
- `SUMMARY_ENABLED=true`
- `MAX_CONCURRENT_TRANSCRIPTION_JOBS=1`
- `MEETING_BOT_STOP_TIMEOUT_SECONDS=90`

## Auth And Email

Auth is enabled when:
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

Notification email is enabled when:
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_FROM`
- optional `SMTP_USER` / `SMTP_PASS`

## Useful Commands

Run all tests:

```bash
npm test
```

Build everything:

```bash
npm run build
```

Validate active OpenSpec changes:

```bash
openspec validate add-authenticated-media-archive --strict --no-interactive
openspec validate add-codex-transcript-summaries --strict --no-interactive
openspec validate add-operator-bot-stop-controls --strict --no-interactive
```

Repair previously stored mojibake upload file names:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ainotetacker \
node scripts/fix_uploaded_audio_filenames.mjs
```

## Troubleshooting

### `Codex Summary` does not appear

Check the transcription worker environment:
- `SUMMARY_ENABLED=true`
- `CODEX_HOME` is mounted into the container

### Chinese upload file names look wrong

New uploads are normalized automatically.

Older rows can be repaired with:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ainotetacker \
node scripts/fix_uploaded_audio_filenames.mjs
```

### Meeting bot says it is recording but transcript is garbage

That usually means the meeting-bot audio chain did not capture real meeting audio.

Check:
- the meeting has another real participant
- shared computer audio is actually audible to another attendee
- `meeting-bot` logs show non-zero audio levels instead of continuous `peakLevel: 0`

### Upload jobs feel slow even on a strong machine

Check:
- `transcription-worker` is using `cuda`
- `nvidia-smi` shows actual GPU utilization
- later upload jobs may simply be queued behind the current GPU slot

## Worker Docs

- [Recording Worker README](/home/solomon/Andy/AI_NoteTacker/workers/recording-worker/README.md)
- [Transcription Worker README](/home/solomon/Andy/AI_NoteTacker/workers/transcription-worker/README.md)
