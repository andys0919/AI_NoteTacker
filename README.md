# AI NoteTacker

Self-hosted meeting recorder and transcription console.

This project lets an operator:
- submit a direct meeting link so an AI bot joins and records inside a container
- upload audio or video files for Whisper transcription
- let an admin switch future transcription jobs between local Whisper and Azure OpenAI `gpt-4o-mini-transcribe`
- let an admin manage cloud quota, AI routing defaults, and per-user cloud quota overrides
- read full transcripts and Codex summaries in the dashboard
- export completed jobs as Markdown, TXT, SRT, or JSON
- stop a live meeting bot or interrupt an upload/transcription job

## What Works

- Operator dashboard at `http://localhost:3000`
- Meeting-link jobs for supported guest-access links
- Uploaded audio and video transcription
- GPU Whisper transcription with `large-v3` by default
- Admin-only global transcription provider switch:
  - `self-hosted-whisper`
  - `azure-openai-gpt-4o-mini-transcribe`
- Independent summary routing defaults:
  - `local-codex`
  - `azure-openai`
- Submission-time AI policy snapshots for future jobs
- Per-user daily cloud quota reservation and remaining-budget display
- Cloud usage ledger and admin audit history for governance changes
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
  - Azure OpenAI deployment if you want hosted transcription

## Start

For upload-only workflows:

```bash
docker compose up -d --build
```

For full meeting-bot workflows:

```bash
docker compose -f docker-compose.yml -f docker-compose.screenapp.yml up -d --build
```

After the first successful `up -d`, the long-running services use Docker's
`restart: unless-stopped` policy, so they come back automatically after a host
reboot as long as the Docker service starts on boot.

Open:

```text
http://localhost:3000
```

## Auto Start On Boot

This repo is configured so the long-running containers restart automatically
after the machine reboots.

One-time setup:

```bash
systemctl is-enabled docker
```

If that returns anything other than `enabled`, run:

```bash
sudo systemctl enable --now docker
```

Then start the stack once:

Upload-only workflow:

```bash
docker compose up -d --build
```

Full meeting-bot workflow:

```bash
docker compose -f docker-compose.yml -f docker-compose.screenapp.yml up -d --build
```

Notes:
- A later reboot should bring the same containers back automatically.
- If you run `docker compose down`, Docker removes the containers, so you must
  run `docker compose up -d` again afterward.

## Use The Dashboard

### Submit Meeting Link

1. Paste a supported direct meeting link.
2. Keep at least one real participant in the meeting.
3. Wait for the `AI Bot` section to change from joining to recording.
4. If you want the bot to leave and keep the partial recording, click `Exit Meeting`.

Notes:
- Meeting-link jobs are effectively single-slot because there is one shared meeting-bot runtime.
- Additional meeting-link submissions wait in a bounded queue controlled by `MAX_MEETING_JOB_BACKLOG`.
- `Exit Meeting` now asks the bot to finalize the current recording before transcription when possible.
- For a platform-by-platform acceptance checklist that separates local self-verification from real host-admission proof, see [`docs/operations/meeting-platform-verification.md`](/home/solomon/Andy/AI_NoteTacker/docs/operations/meeting-platform-verification.md).

### Upload Recording

1. Drop an audio or video file into the upload card.
2. The dashboard will show `Preparing Media`, `Transcribing Audio`, and `Generating Summary`.
3. If you no longer want the job, click `Interrupt Job`.

Notes:
- Uploaded jobs share the transcription queue.
- `MAX_CONCURRENT_TRANSCRIPTION_JOBS=1` by default, so later jobs queue instead of oversubscribing the GPU.
- `MAX_TRANSCRIPTION_JOB_BACKLOG=10` limits how many jobs may wait for transcription capacity before later uploads are rejected.

### Admin Provider Switch

If your signed-in email is listed in `ADMIN_EMAILS`, the dashboard shows an extra `Transcription Provider` panel.

Use it to switch future transcription claims between:
- local GPU/CPU Whisper
- Azure OpenAI `gpt-4o-mini-transcribe`

Important:
- this is a global switch for future jobs, not a per-job override
- Azure secrets stay in server/worker env only
- jobs already claimed by a transcription worker keep the provider that was locked at claim time

### Cloud Governance

Admins can now manage:
- default transcription provider and model
- default summary provider and model
- pricing version
- default daily cloud quota
- per-user daily cloud quota overrides
- local/cloud transcription concurrency pools
- recent governance audit history

Operators can now see:
- their remaining daily cloud quota
- current reserved cloud quota
- current consumed cloud cost for the day

Important:
- cloud quota applies only to cloud-routed stages
- local execution does not consume cloud quota
- jobs snapshot their AI routing policy at submission time, so later admin changes affect only later jobs

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
- `DEFAULT_TRANSCRIPTION_PROVIDER=self-hosted-whisper`
- `DEFAULT_SUMMARY_PROVIDER=local-codex`
- `SUMMARY_ENABLED=true`
- `MAX_CONCURRENT_TRANSCRIPTION_JOBS=1`
- `MAX_MEETING_JOB_BACKLOG=2`
- `MAX_TRANSCRIPTION_JOB_BACKLOG=10`
- `DEFAULT_DAILY_CLOUD_QUOTA_USD=5`
- `LIVE_MEETING_RESERVATION_CAP_USD=1.5`
- `AI_PRICING_VERSION=v1`
- `MEETING_BOT_STOP_TIMEOUT_SECONDS=90`

## Auth And Email

Auth is enabled when:
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

Admin provider switching is enabled for authenticated emails listed in:
- `ADMIN_EMAILS`

Azure hosted transcription becomes selectable only when all of these are configured on the control-plane and transcription-worker:
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_DEPLOYMENT`
- `AZURE_OPENAI_API_KEY`
- optional `AZURE_OPENAI_API_VERSION`

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
openspec validate add-admin-transcription-provider-switch --strict --no-interactive
```

Repair previously stored mojibake upload file names:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ainotetacker \
node scripts/fix_uploaded_audio_filenames.mjs
```

Run the docker-compose runtime smoke:

```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.local/share/codex}"
docker compose -f docker-compose.yml -f docker-compose.smoke.yml up -d --build --remove-orphans
node scripts/run_runtime_smoke.mjs --base-url http://127.0.0.1:3000 --timeout-ms 300000
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

### Azure provider shows `Not Ready`

Check:
- your signed-in email is listed in `ADMIN_EMAILS`
- `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, and `AZURE_OPENAI_API_KEY` are set in the runtime environment
- the control-plane and transcription-worker containers were recreated after env changes

## Worker Docs

- [Recording Worker README](/home/solomon/Andy/AI_NoteTacker/workers/recording-worker/README.md)
- [Transcription Worker README](/home/solomon/Andy/AI_NoteTacker/workers/transcription-worker/README.md)

## Rollout Guidance

- [100-User Rollout Profile](/home/solomon/Andy/AI_NoteTacker/docs/operations/100-user-rollout.md)
