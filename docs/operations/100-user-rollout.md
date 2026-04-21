# 100-User Rollout Profile

This document defines the initial deployment profile behind any claim that this service is ready for a 100-person internal company rollout.

## Scope

This profile assumes:
- roughly 100 named employees can access the service
- daily usage is staggered, not company-wide simultaneous peak load
- live meeting capture is the scarce path and must remain explicitly capacity-limited
- upload transcription is allowed to queue behind configured worker pools

This profile does **not** mean:
- 100 simultaneous live meeting bots
- unlimited archive growth without storage planning
- multi-region or highly available control-plane replicas

## Supported Concurrency Profile

Initial supported profile:
- live meeting capture: `1` active meeting bot at a time
- live meeting backlog: `2` queued meeting-link jobs by default via `MAX_MEETING_JOB_BACKLOG=2`
- local transcription concurrency: `1` by default
- cloud transcription concurrency: `1` by default
- transcription backlog: `10` waiting jobs by default via `MAX_TRANSCRIPTION_JOB_BACKLOG=10`
- local summary concurrency: `1` by default
- cloud summary concurrency: `1` by default

Operational expectation:
- a fourth simultaneous meeting-link submission should be rejected by default instead of joining an unbounded queue
- upload jobs may queue behind active transcription capacity and should remain visible as queued or waiting work
- summary backlog must not block unrelated transcription claims

## Minimum Deployment Topology

Minimum runtime for this rollout profile:
- `1` control-plane instance
- `1` postgres instance with persistent storage
- `1` redis instance
- `1` minio or equivalent S3-compatible object store
- `1` recording worker
- `1` transcription worker
- `1` summary worker
- `1` meeting-bot runtime for full meeting workflows

Recommended host baseline for the default local-GPU profile:
- `8` CPU cores
- `32 GB` RAM
- `1` NVIDIA GPU suitable for `faster-whisper large-v3`
- fast SSD storage for temp files, object data, and postgres data

If the deployment uses cloud transcription or cloud summary heavily, increase the relevant concurrency pools only after verifying quota policy, callback idempotency, and queue drain behavior under load.

## Network Boundaries

The public dashboard may be exposed through public ingress, but these routes should remain private to the trusted worker network or be separately restricted:
- `/recording-workers/claims`
- `/transcription-workers/claims`
- `/transcription-workers/summary-claims`
- `/summary-workers/claims`
- `/recording-jobs/:id/events`
- meeting-bot callback routes

Internal callers must use `INTERNAL_SERVICE_TOKEN`, and public browser reachability alone must not be enough to invoke worker-state mutation routes.

## Go / No-Go Checklist

Do not describe the deployment as ready for this rollout profile until all items below pass.

### 1. Configuration

- `docker compose config --quiet` succeeds for the intended deployment files
- `INTERNAL_SERVICE_TOKEN` is set for control-plane and workers
- `MAX_MEETING_JOB_BACKLOG` is intentionally set and documented for operators
- concurrency pools match the intended rollout shape

### 2. Verification

- `npm test`
- `npm run build --workspace @ai-notetacker/control-plane`
- `openspec validate refactor-company-scale-runtime --strict --no-interactive`

For a local compose-backed smoke that exercises upload, summary, export, and stubbed meeting-link orchestration end to end:

```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.local/share/codex}"
docker compose -f docker-compose.yml -f docker-compose.smoke.yml up -d --build --remove-orphans
node scripts/run_runtime_smoke.mjs --base-url http://127.0.0.1:3000 --timeout-ms 300000
```

Notes:
- `docker-compose.smoke.yml` disables Supabase auth, forces local-provider defaults, creates the MinIO bucket, and adds a stub artifact server so meeting-link jobs can drive the downstream runtime without a real meeting bot.
- the smoke asset is synthetic audio, so transcript segments may legitimately be empty even when the runtime path succeeds; pass/fail is based on job completion plus transcript artifact, summary artifact, list/detail visibility, and export success.
- real Google Meet / Teams / Zoom admission and recording checks require a separate upstream-platform acceptance runbook at [`docs/operations/meeting-platform-verification.md`](/home/solomon/Andy/AI_NoteTacker/docs/operations/meeting-platform-verification.md)

### 3. Capacity Behavior

Using the real deployment or a staging-equivalent environment:

Repeatable probe helper:

```bash
node scripts/run_runtime_load_probe.mjs \
  --base-url http://127.0.0.1:3000 \
  --meeting-url https://meet.google.com/abc-defg-hij \
  --meetings 4 \
  --uploads 3 \
  --audio-file /absolute/path/to/sample.wav
```

1. Submit `4` meeting-link jobs in quick succession.
2. Verify:
- exactly `1` job is actively joining or recording
- at most `2` additional meeting-link jobs remain queued with `waiting-for-recording-capacity`
- the extra meeting submission is rejected with a capacity error

3. Submit at least `3` upload jobs larger than a trivial sample.
4. Verify:
- only configured transcription concurrency is active at once
- later jobs remain visible in queued or waiting states
- the control-plane process does not exhaust heap memory during upload bursts

### 4. Recovery Behavior

1. Claim a meeting or transcription job.
2. Stop the corresponding worker before it finishes.
3. Verify:
- stale work is reclaimed or released without manual database repair
- stale callbacks from the superseded lease do not overwrite the newer job state

### 5. Queue Drain And Cost Governance

- after transcript completion but before summary completion, cloud `reservedUsd` remains non-zero for a cloud-summary job
- after all configured billable stages settle, `reservedUsd` returns to `0`
- duplicate transcript or summary callbacks do not increase consumed cloud usage more than once

## Current Known Limits

This rollout profile still has important limits:
- no HA control-plane deployment guidance yet
- archive list hot path still needs full pagination rollout and thinner repository access
- lease liveness still depends mainly on current claim and stale-job handling rather than explicit heartbeat metadata

Treat this profile as the initial safe internal rollout target, not the final scale ceiling.
