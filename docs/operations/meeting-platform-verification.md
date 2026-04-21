# Meeting Platform Verification

This runbook defines what can be self-verified locally for live meeting capture
and what still requires a real host-managed meeting on each upstream platform.

It is intentionally stricter than the dashboard UI. A card that says
"joining", "recording", or "finalizing" is not sufficient proof that
Google Meet, Microsoft Teams, or Zoom recording actually worked end to end.

## Verification Boundary

The current repository can self-verify all of the following without a real
third-party meeting host:

- supported link acceptance for Google Meet, Microsoft Teams, and Zoom
- recording-worker dispatch to the correct ScreenApp meeting-bot join endpoint
- platform-specific detection that a join request reached the lobby / waiting-room
  state and was reported back to the control-plane as
  `waiting-for-host-admission`
- control-plane handling of lobby failures, stale joins, stop-current behavior,
  completion callbacks, transcript callbacks, and summary callbacks
- end-to-end downstream processing after a meeting-bot completion webhook

The repository cannot fully self-verify the following without a real live
meeting and a real host on the upstream platform:

- whether the browser bot is admitted from the lobby or waiting room
- whether platform-specific guest access or web join settings allow the bot in
- whether the platform produces a real recording artifact after admission

Treat the first set as local integration proof and the second set as external
acceptance proof.

## Local Self-Verification

Run these commands from the repo root:

```bash
npm exec --workspace @ai-notetacker/control-plane -- vitest run \
  test/recording-jobs-api.test.ts \
  test/meeting-bot-status-api.test.ts \
  test/meeting-bot-integration.test.ts

npm exec --workspace @ai-notetacker/recording-worker -- vitest run \
  test/screenapp-meeting-bot-executor.test.ts
```

What these prove:

- Google Meet links of the form `https://meet.google.com/xxx-xxxx-xxx` are accepted.
- Teams links of the form `https://teams.microsoft.com/l/meetup-join/...` and
  `https://teams.live.com/meet/...` are accepted.
- Zoom links of the form `https://zoom.us/j/<meeting-id>` are accepted, including
  the common invite form with embedded `pwd=` and `omn=` query parameters.
- Zoom web-client links of the form `https://app.zoom.us/wc/join/<meeting-id>` or
  `https://<subdomain>.zoom.us/wc/join/<meeting-id>` are also accepted.
- The recording worker dispatches:
  - Google Meet jobs to `/google/join`
  - Teams jobs to `/microsoft/join`
  - Zoom jobs to `/zoom/join`
- Lobby and stale-join failures are persisted as terminal job failures instead
  of pretending recording finalization succeeded.
- When the meeting bot sees lobby / waiting-room evidence after pressing the
  platform join action, it emits a `JoinRequest.Submitted` info log and the
  job moves into `waiting-for-host-admission` with a platform-specific message.
- A valid completion webhook advances a meeting-link job into transcription and
  later summary processing.

## Platform Prerequisites

These are the upstream platform conditions that must be true before a real
meeting can be considered a valid acceptance test.

### Google Meet

- Use a direct Meet link such as `https://meet.google.com/xxx-xxxx-xxx`.
- Keep at least one real participant in the meeting.
- If the meeting is not `Open`, the host must still allow external guests to ask
  to join and must admit the bot.
- If `Anyone with the meeting link can ask to join` is disabled, an uninvited
  browser bot can be declined automatically.
- If `Host must join before anyone else` is enabled, no guest join is possible
  until a host is present.

### Microsoft Teams

- Use a direct Teams join link, not a landing page that requires a prior
  authenticated redirect.
- Confirm external browser participants can reach the meeting at all.
- Review the meeting access / lobby policy. If the bot is treated as an
  external or unauthenticated participant, a host or organizer may need to
  admit it manually.
- Do not assume the `Everyone` lobby option is enough; tenant policy may still
  route unauthenticated users to the lobby.

### Zoom

- Use a direct Zoom join link that matches the repository policy:
  `https://zoom.us/j/<meeting-id>` with or without embedded query parameters
  such as `pwd=` or `omn=`.
- If the host or operator pastes a direct Zoom web-client URL instead, the
  repository also accepts `.../wc/join/<meeting-id>` links.
- The host must expose `Join from Your Browser`; otherwise the bot cannot rely
  on browser join.
- `Only authenticated users can join from web client` must be disabled for the
  meeting context that the bot uses.
- Waiting Room must not trap the browser bot indefinitely.

## Real Meeting Acceptance Test

Repeat this per platform: Google Meet, Microsoft Teams, Zoom.

### 1. Manual Browser Pre-Check

Before involving the bot, use an incognito browser window as a non-host guest.

Pass criteria:

- the guest can reach the join UI
- the guest can either enter directly or appear in a lobby/waiting room where a
  host can admit them

Fail criteria:

- the platform forces a proprietary desktop client
- the platform requires an authenticated account before any join attempt
- the host cannot see or admit the guest from the lobby/waiting room

If the manual browser pre-check fails, stop. The bot will not be more capable
than a normal browser guest.

### 2. Bot Join And Recording Check

Start the full meeting-bot stack:

```bash
docker compose -f docker-compose.yml -f docker-compose.screenapp.yml up -d --build
```

In another shell, watch the runtime:

```bash
docker compose -f docker-compose.yml -f docker-compose.screenapp.yml logs -f \
  control-plane recording-worker meeting-bot transcription-worker summary-worker
```

Submit one meeting-link job from the dashboard.

Pass criteria:

- meeting-bot logs show the platform join flow progressing past lobby/waiting room
- the job leaves `joining`
- `recording_artifact` becomes present
- the job later reaches transcript and summary artifact creation

Fail criteria:

- repeated lobby / waiting room timeout messages
- the job stays in `joining` and never produces a recording artifact
- the job finishes as `meeting-not-admitted` or a platform-specific lobby timeout

### 3. Artifact Confirmation

Use Postgres, not just the dashboard:

```bash
docker exec ai_notetacker-postgres-1 psql -U postgres -d ainotetacker -c "
select id, state, processing_stage, failure_code,
       recording_artifact is not null as has_recording,
       transcript_artifact is not null as has_transcript,
       summary_artifact is not null as has_summary,
       updated_at
from recording_jobs
order by created_at desc
limit 10;
"
```

True end-to-end success requires all of these:

- `has_recording = true`
- `has_transcript = true`
- `has_summary = true`
- `state = completed`

If the meeting-bot leaves the lobby but no recording artifact is produced, the
run is not a successful recording verification.

## Current Known Limits

- Google Meet and Teams can still be blocked by host approval or tenant policy,
  even when the repository accepts the link format.
- Zoom browser-join support depends on host-side settings outside this repo.
- The runtime is single-slot for live meeting capture, so run only one real
  live acceptance test at a time.
