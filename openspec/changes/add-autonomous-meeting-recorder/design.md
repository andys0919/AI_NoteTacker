## Context

The repository is currently in planning mode with no application implementation yet. Prior research identified `screenappai/meeting-bot` as the strongest open-source base for autonomous meeting joins because it records inside an isolated browser/container environment instead of relying on the user's host audio output. The product requirement has since been narrowed further: use direct-link meeting joins where supported, avoid storing user platform credentials, and use Whisper as the only transcription engine in the MVP.

The main architectural challenge is separating a user's submission action from the actual recording runtime. The system must accept a meeting link from one machine, but the browser session, media capture, and transcription must occur on dedicated workers that can run unattended and independently.

## Goals / Non-Goals

**Goals:**
- Accept a meeting link and create a trackable recording job.
- Join supported meetings inside dedicated workers rather than on the submitter's workstation.
- Capture recordings in a worker-local environment and store artifacts centrally.
- Transcribe recordings using Whisper only.
- Surface explicit failure reasons for unsupported or authentication-gated meetings.

**Non-Goals:**
- No AI meeting summaries or action-item extraction in the MVP.
- No enterprise login automation, SSO flows, or credential vaulting in the MVP.
- No native mobile capture path.
- No promise of universal support for all Zoom, Teams, and Meet access policies.

## Decisions

### 1. Use a control plane plus worker plane split

The system will be split into:
- A control plane API for job submission, status retrieval, and artifact metadata.
- Recording workers for browser automation and media capture.
- Transcription workers for Whisper processing.

This is preferred over a single monolithic process because recording and transcription have different runtime profiles, scaling needs, and failure modes.

Alternative considered:
- Single-process service running API, browser, and transcription together.
Reason rejected:
- Harder to isolate crashes, harder to scale, and risks resource contention between recording and transcription.

### 2. Base recording workers on isolated browser automation, not desktop capture

Recording must happen inside dedicated Linux containers or VMs running Playwright/Chromium, Xvfb, PulseAudio, and FFmpeg where needed. This keeps the user's workstation out of the media path entirely.

Alternative considered:
- Local desktop capture with system audio interception.
Reason rejected:
- Violates the independence requirement and competes with the user's normal machine usage.

### 3. Fork and adapt `screenappai/meeting-bot` rather than building join automation from scratch

The researched base already proves the viability of:
- Direct-link meeting joins
- Guest or anonymous flows where supported
- Container-local audio/video capture
- Platform-specific capture paths for Google Meet, Zoom, and Teams

Alternative considered:
- Build a custom Playwright bot from scratch.
Reason rejected:
- Higher schedule risk with no compensating advantage at MVP stage.

### 4. Use Whisper-only transcription, implemented with `faster-whisper`

The transcription pipeline will process stored recordings after capture completes. `faster-whisper` is the preferred implementation because it preserves Whisper model behavior while improving deployment practicality on CPU or GPU nodes.

Alternative considered:
- Hosted STT APIs
- Browser captions scraping
Reason rejected:
- Hosted STT violates the Whisper-only constraint; captions scraping is less complete and less reliable than transcript generation from the original recording.

### 5. Persist raw recordings and transcript artifacts separately

The system will store:
- Original recording artifact in object storage
- Extracted audio derivative if needed
- Whisper transcript artifact
- Job metadata and indexes in PostgreSQL

This allows re-transcription, auditability, and future improvements without forcing another meeting join.

Alternative considered:
- Store transcript only.
Reason rejected:
- Removes the ability to re-run improved transcription or inspect failures.

### 6. Treat meeting support as an explicit policy gate

The system will validate jobs against a documented support matrix before or during join:
- Direct-link guest or anonymous join supported
- No hard login wall
- No enterprise SSO requirement
- No extra interactive password challenge outside supported link semantics

Alternative considered:
- Try to automate unsupported flows opportunistically.
Reason rejected:
- Produces brittle automation and unpredictable failure modes.

## Risks / Trade-offs

- [Meeting platform UI changes] -> Pin a fork, add smoke tests, and isolate selectors per platform.
- [Zoom or Teams policy restrictions] -> Fail fast with support-matrix validation and clear operator-visible reasons.
- [CPU-only Whisper latency] -> Allow a separate transcription queue and optional GPU worker class.
- [Large recordings consume storage quickly] -> Add retention policies and artifact lifecycle rules.
- [Single worker bottlenecks] -> Design queue boundaries now so horizontal scaling can be added without API redesign.

## Migration Plan

1. Initialize the control-plane repository structure and OpenSpec artifacts.
2. Fork or vendor the recording worker base from `screenappai/meeting-bot`.
3. Implement a minimal job API with persistent metadata and object storage upload.
4. Implement one end-to-end platform flow first, preferably Google Meet guest joins.
5. Add Whisper transcription workers and transcript persistence.
6. Expand support matrix platform by platform, starting with the least authentication-heavy flows.

Rollback strategy:
- If autonomous joins prove unstable on a specific platform, disable that platform in the support matrix while retaining the rest of the system.

## Open Questions

- Which platform should be the first production target: Google Meet, Teams, or Zoom?
- Is GPU expected in the first deployment, or must CPU-only Whisper performance be acceptable?
- Does the MVP require speaker diarization, or is timestamped transcript text sufficient?
- Should completed artifacts be retained indefinitely or governed by configurable retention windows?
