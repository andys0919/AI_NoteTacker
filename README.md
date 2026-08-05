# AI NoteTacker

Self-hosted meeting recorder and transcription console.

This project lets an operator:
- submit a direct meeting link so an AI bot joins and records inside a container
- upload audio or video files for Whisper transcription
- let an admin switch future transcription jobs among MAI-Transcribe 1.5, Qwen,
  local Whisper, and Azure OpenAI `gpt-4o-transcribe`
- let an admin manage AI routing defaults and review cloud usage
- read full transcripts and Codex or Azure OpenAI summaries in separate,
  responsive dashboard tabs
- export completed jobs as Markdown, TXT, SRT, or JSON
- stop a live meeting bot or interrupt an upload/transcription job

## What Works

- Operator dashboard at `http://localhost:3000`
- Meeting-link jobs for supported guest-access links
- Uploaded audio and video transcription
- GPU Whisper transcription; the canonical runtime template uses `tiny`
- Admin-only global transcription provider switch:
  - `self-hosted-whisper`
  - `qwen3-asr-1.7b`
  - `azure-speech-mai-transcribe-1.5`
  - `azure-openai-gpt-4o-transcribe`
- Independent summary routing defaults:
  - `local-codex`
  - `azure-openai`
- Submission-time AI policy snapshots for future jobs
- Cloud reservation estimates and daily usage reporting without submission blocking
- Cloud usage ledger and admin audit history for governance changes
- Codex or Azure OpenAI summary generation with a content-derived title,
  confirmed/mixed/open topics, topic subtopics, grouped follow-ups, decisions,
  risks, open questions, and evidence-backed analysis notes
- Archive search, history timeline, and export
- On-demand long-form reader with summary navigation and separate transcript
  timestamp and wording fields
- Email notifications for completed or failed authenticated jobs when SMTP is configured

## Prerequisites

- Docker and Docker Compose
- NVIDIA driver + `nvidia-smi` if you want GPU transcription
- `CODEX_HOME` on the host only if you want local Codex summaries inside the summary worker
- Optional:
  - Supabase project for backend operator bearer-token verification
  - SMTP provider for notification emails
  - Azure OpenAI deployments if you want hosted transcription or summaries

## Configure

Create your live config from the template, then fill in any secrets (Azure
OpenAI keys, admin emails, etc.):

```bash
cp .env.example .env
```

Docker Compose uses `.env` (gitignored) for interpolation. The transcription and
summary services receive explicit stage-specific values; other services load
the file directly. `.env.example` is the committed development template — never
put real secrets there. Before exposing a production deployment, replace the
sample admin, session, internal service, database, and object-storage
credentials.

## Start

Use the deploy helper — it always brings up the correct file set:

```bash
./scripts/deploy.sh up
```

This is equivalent to:

```bash
docker compose -f docker-compose.yml -f docker-compose.screenapp.yml up -d --build --remove-orphans
```

> [!IMPORTANT]
> **Do not bring the meeting-bot stack up with a bare `docker compose up -d`.**
> The real meeting recorder lives in `docker-compose.screenapp.yml`. If you omit
> that override, the `recording-worker` falls back to the `stub` executor and
> **never records real Zoom/Google/Teams meetings** (it only emits a placeholder
> artifact), and the control-plane loses its meeting-bot monitoring.
> `scripts/deploy.sh` exists specifically to prevent this. The recording-worker
> also logs its mode on startup — `executor=screenapp` is correct for production;
> `executor=stub` prints a loud warning.
> The production Compose regression test also verifies that this override does
> not replace the `SUMMARY_MODEL` selected through `.env`.

Upload-only (no live meeting bot) workflows can still use the base file alone:

```bash
docker compose up -d --build   # recording-worker runs in stub mode by design
```

After the first successful `up -d`, the long-running services use Docker's
`restart: unless-stopped` policy, so they come back automatically after a host
reboot as long as the Docker service starts on boot.

The control-plane does not mount the host Docker socket. `Exit Meeting` calls an
authenticated private endpoint inside the meeting-bot container, which can stop
only that process; Docker's restart policy then recreates its runtime. Third-party
runtime images and directly installed worker dependencies are pinned for repeatable
rebuilds. PostgreSQL schema setup is recorded in `schema_migrations` and serialized
with an advisory transaction lock during control-plane startup.

Compose builds separate `transcription` and `summary` targets from the existing
worker Dockerfile. The Node services use build/runtime stages so compilers and
test packages are not retained in their production images.

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

Then start the stack once (full meeting-bot workflow):

```bash
./scripts/deploy.sh up
```

Notes:
- A later reboot should bring the same containers back automatically.
- If you run `./scripts/deploy.sh down` (or `docker compose ... down`), Docker
  removes the containers, so you must run `./scripts/deploy.sh up` again afterward.
- Always re-deploy with `scripts/deploy.sh`, never a bare
  `docker compose up`, so the recording-worker keeps `RECORDING_EXECUTOR=screenapp`.

## Use The Dashboard

### Submit Meeting Link

1. Paste a supported direct meeting link.
2. Keep at least one real participant in the meeting.
3. Wait for the `AI Bot` section to change from joining to recording.
4. If you want the bot to leave and keep the partial recording, click `Exit Meeting`.

Notes:
- Meeting-link jobs are effectively single-slot because there is one shared meeting-bot runtime.
- Additional meeting-link submissions wait in a bounded queue controlled by `MAX_MEETING_JOB_BACKLOG`.
- Deleting one completed/failed history item, or clearing history, first deletes
  its uploaded/recording object keys from S3/MinIO. The hidden database row keeps
  transcript and summary evidence for administrator audit. If object cleanup
  fails, the history item stays visible so the operator can retry.
- `Exit Meeting` now asks the bot to finalize the current recording before transcription when possible.
- For a platform-by-platform acceptance checklist that separates local self-verification from real host-admission proof, see [`docs/operations/meeting-platform-verification.md`](docs/operations/meeting-platform-verification.md).

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
- Azure OpenAI `gpt-4o-transcribe`

Important:
- this is a global switch for future jobs, not a per-job override
- Azure secrets stay in server/worker env only
- jobs already claimed by a transcription worker keep the provider that was locked at claim time

### Cloud Governance

Admins can now manage:
- default transcription provider and model
- default summary provider and model
- pricing version
- local/cloud transcription concurrency pools
- recent governance audit history

Operators can now see:
- their informational daily cloud budget status
- current estimated cloud reservation
- current consumed cloud cost for the day

Important:
- daily cloud budget values are informational and never reject a submission
- local execution does not consume cloud quota
- jobs snapshot their AI routing policy at submission time, so later admin changes affect only later jobs
- usage whose model/version has no authoritative pricing-catalog entry is shown as
  `unpriced`, not `NT$0.00`; the known priced subtotal remains a lower bound until a rate is supplied

As of 2026-07-31, pricing catalog `v1` includes the verified
`gpt-5.6-luna` Global Standard rates and the Azure Speech Fast Transcription rate
used by `mai-transcribe-1.5`. Azure does not return Luna cache-write token
quantity in the Responses usage payload, so the UI shows the calculable
input/cached-input/output amount as `（含未定價用量）` instead of hiding the
known amount. Historical `gpt-4o-transcribe-diarize` rows that preserve only
audio duration also remain unpriced because that model is billed through
separate token meters.

The ledger, quota enforcement, and APIs remain in USD. Operator and admin
screens display TWD through one reference conversion verified against the
Azure Retail Prices API on 2026-07-31: USD 0.36/hour and TWD 11.4903/hour for
the exact MAI meter, equivalent to `1 USD = NT$31.9175`. This is a public retail
estimate, not the subscription invoice effective price. Admin quota fields are
entered in TWD and converted back to the existing USD API precision on save.

### Read Results

Completed jobs can show:
- Full Transcript
- Codex or Azure OpenAI Summary
- a content-derived meeting title and topic/subtopic notes with confirmed,
  mixed, or open status
- only the non-empty grouped follow-up, decision, risk, open-question, and
  analysis-note sections
- Job Timeline
- export buttons

### Export

Completed jobs support:
- `Export MD`
- `Export TXT`
- `Export SRT`
- `Export JSON`

## Current Runtime Defaults

Important defaults from [`.env.example`](.env.example):

- `WHISPER_MODEL=tiny`
- `WHISPER_DEVICE=cuda`
- `WHISPER_COMPUTE_TYPE=float16`
- `DEFAULT_TRANSCRIPTION_PROVIDER=azure-speech-mai-transcribe-1.5`
- `DEFAULT_SUMMARY_PROVIDER=azure-openai`
- `SUMMARY_MODEL=gpt-5.6-luna`
- `SUMMARY_REASONING_EFFORT=high`
- `AZURE_OPENAI_SUMMARY_TIMEOUT_SECONDS=900`
- `MAX_CONCURRENT_TRANSCRIPTION_JOBS=1`
- `MAX_MEETING_JOB_BACKLOG=2`
- `MAX_TRANSCRIPTION_JOB_BACKLOG=10`
- `DEFAULT_DAILY_CLOUD_QUOTA_USD=5`
- `LIVE_MEETING_RESERVATION_CAP_USD=1.5`
- `AI_PRICING_VERSION=v1`
- `MEETING_BOT_STOP_TIMEOUT_SECONDS=90`

The template selects the cloud providers but leaves their endpoint/key values
blank. Fill the required Azure values before using those routes, or switch the
default policies to the local providers.

## Backend Operator Auth And Email

Backend operator token verification is enabled when:
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

Admin provider switching is enabled for authenticated emails listed in:
- `ADMIN_EMAILS`

Azure hosted transcription becomes selectable only when all of these are configured on the control-plane and transcription-worker:
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_DEPLOYMENT`
- `AZURE_OPENAI_API_KEY`
- optional `AZURE_OPENAI_API_VERSION`
- optional `AZURE_OPENAI_TRANSCRIBE_TIMEOUT_SECONDS` (default `300`)

Azure Speech MAI becomes selectable only when all of these are configured:

- `AZURE_SPEECH_MAI_ENDPOINT`
- `AZURE_SPEECH_MAI_MODEL=mai-transcribe-1.5`
- `AZURE_SPEECH_MAI_API_KEY`
- optional `AZURE_SPEECH_MAI_API_VERSION` (default `2025-10-15`)
- optional `AZURE_SPEECH_MAI_TIMEOUT_SECONDS` (default `300`)

MAI processes up to three independent 30-second `verbatim` chunks concurrently,
restores timestamp order, and sends no phrase list, forced locale, PLAUD text,
or stored comparison transcript. HTTP 400 receives one identical retry;
transient DNS, timeout, reset, or broken-connection failures use bounded
2/10/30-second identical-request retries. MAI provider wording is preserved as
`rawText`; when its locale is Chinese, only `displayText` is deterministically
converted to Traditional Chinese and the segment language becomes `zh-Hant`.
The transcription worker does not call Luna or speaker diarization.

The bundled Qwen service is an optional Compose profile and does not start or
block the MAI production path. To use it explicitly, start with
`--profile qwen` and configure `QWEN_ASR_ENDPOINT=http://qwen3-asr:8000`.

Speaker classification is disabled in the transcription worker.
Historical speaker metadata remains schema-compatible, but the reader, summary
prompt, admin transcript, and text exports do not present it.

The generic summary prompt is coverage-first: it reviews the beginning, middle,
and final third, derives a specific meeting title, groups repeated discussion
into content-derived topics and subtopics, keeps distinct process, requirement,
exception, dependency, scope, schedule, and outcome discussions separate, and
classifies only explicit grouped follow-ups, decisions, risks, and open
questions. Evidence-backed analysis notes are optional. Compatibility
`keyPoints` and `actionItems` are derived from the hierarchy without a second
model request. The prompt contains no PLAUD answer or meeting-specific topic
list.

Azure hosted summary requires explicit Responses API configuration on the
control-plane and summary worker:

- `AZURE_OPENAI_SUMMARY_ENDPOINT` — HTTPS URL whose normalized path is exactly `/openai/v1/responses`
- `AZURE_OPENAI_SUMMARY_API_KEY`
- `SUMMARY_MODEL`
- `SUMMARY_REASONING_EFFORT=high`
- optional `AZURE_OPENAI_SUMMARY_TIMEOUT_SECONDS` (default `900`)

Python transcription/summary worker GET/POST/heartbeat calls use
`CONTROL_PLANE_TIMEOUT_SECONDS` (default `30`).

The summary endpoint/key are not inferred from the transcription endpoint/key
and are not exposed to the transcription worker. The summary caller sends
`store: false` to disable Responses application-state/message-history storage
and requires a finite positive socket-operation timeout. Azure transcription
uploads and Python
transcription/summary worker-to-control-plane calls have the same finite-timeout
rule. These settings bound blocking socket
operations rather than the entire workflow. `store: false` is not by itself a
zero-data-retention guarantee.

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

Validate every active OpenSpec change:

```bash
openspec validate --all --strict --no-interactive
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

### Summary does not appear

For local Codex, check the summary worker environment:

- `CODEX_HOME` is mounted into the container
- `CODEX_CLI_PATH` resolves to the Codex executable

For Azure OpenAI, also check:

- `AZURE_OPENAI_SUMMARY_ENDPOINT` ends at `/openai/v1/responses`
- `AZURE_OPENAI_SUMMARY_API_KEY` is set independently of the transcription key
- `SUMMARY_MODEL` names the Azure deployment
- the control-plane and summary-worker were recreated after summary env changes

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

- [Recording Worker README](workers/recording-worker/README.md)
- [Transcription Worker README](workers/transcription-worker/README.md)

## Rollout Guidance

- [100-User Rollout Profile](docs/operations/100-user-rollout.md)
