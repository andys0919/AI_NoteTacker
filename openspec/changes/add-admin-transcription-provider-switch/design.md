## Context

The current transcription worker is wired directly to `FasterWhisperTranscriber` at process startup. That is fine for a single-provider system, but it makes runtime provider switching impossible without changing env and rebuilding/restarting workers. The current dashboard also has no concept of system administration beyond authenticated operator identity; every authenticated user can submit jobs, but nobody can safely change global infrastructure behavior from the UI.

This change introduces a cross-cutting behavior change:
- the transcription provider becomes configurable at runtime
- a hosted provider becomes an approved option alongside local Whisper
- the setting must be admin-only
- Azure secrets must remain server-side

The first slice should stay deliberately small. It only needs one global switch, not per-job provider selection, not multiple hosted vendors, and not full secret editing in the browser.

## Goals / Non-Goals

**Goals**
- Let a configured admin switch the global transcription provider from the dashboard.
- Support two providers in the first slice: local `faster-whisper` and Azure OpenAI `gpt-4o-mini-transcribe`.
- Keep Azure endpoint/deployment/key in server/worker env only.
- Make provider selection durable across service restarts.
- Ensure each transcription attempt records which provider actually processed it.

**Non-Goals**
- No per-job provider override.
- No browser-based secret management.
- No automatic fallback from Azure to local Whisper or vice versa.
- No additional hosted STT vendors in this change.

## Decisions

### 1. Persist the global provider setting in PostgreSQL, not only in env

The selected provider should survive container restarts and be changeable from the UI without editing deployment files. The control-plane will therefore store a small durable system setting, with env only supplying:
- the default provider used on first boot
- hosted-provider readiness inputs such as Azure endpoint/deployment/key
- the list of admin emails allowed to manage the setting

This keeps secrets in env while making the non-secret selection durable and operator-visible.

### 2. Authorize provider management through an env-driven admin email allowlist

The system already has authenticated operator identity, but it does not yet have a generalized role model. The smallest secure step is to authorize admin-only endpoints by checking the authenticated operator email against a configured allowlist such as `ADMIN_EMAILS`.

This avoids inventing a broader RBAC system just to protect one settings panel.

### 3. Lock the effective provider onto each job when a transcription worker claims it

The provider setting is global, but jobs should remain auditable and stable once transcription starts. When a worker claims a transcribing job, the control-plane should resolve the current global provider and attach that effective provider to the claimed job/attempt. If the admin flips the global setting later, already-running or already-claimed work continues with its locked provider, while later claims use the new one.

This prevents ambiguous outcomes where a job starts under one provider but later retries or status reads appear to belong to another.

### 4. Keep secrets server-side and expose only readiness metadata to the admin UI

The dashboard does not need Azure secrets. It only needs to know:
- which providers are available
- which provider is currently selected
- whether Azure is correctly configured and therefore selectable

The control-plane admin API should therefore expose non-secret readiness metadata, while the worker reads Azure endpoint/deployment/key from env at runtime.

### 5. Use a provider factory with transcriber adapters in the worker

`worker_loop.py` already depends on a narrow `transcriber.transcribe(...)` contract. The worker will keep that contract and swap concrete adapters behind a provider factory:
- `FasterWhisperTranscriber`
- `AzureOpenAiTranscriber`

This is the smallest change that supports runtime selection without rewriting the rest of the pipeline.

## Data Flow

1. Admin signs in with an email that is present in `ADMIN_EMAILS`.
2. Dashboard fetches the current effective transcription provider from a control-plane admin endpoint.
3. Admin switches the provider.
4. Control-plane validates the requested provider:
   - local Whisper is always selectable if the local worker path is enabled
   - Azure is only selectable when required env values are present
5. Control-plane persists the selected provider setting.
6. When a transcription worker claims the next job, the control-plane resolves and returns the effective provider for that claim and records it on the job/attempt.
7. The worker provider factory selects the matching transcriber adapter and runs transcription.

## Risks / Trade-offs

- [Admin authorization is email-allowlist based] -> acceptable for the first slice because it is smaller than introducing full RBAC, but it should be replaceable later.
- [Azure config can be partially present or invalid] -> admin APIs must report readiness clearly and refuse selection when required env is missing.
- [Hosted STT is now an approved dependency] -> the updated spec should make this explicit so operators are not surprised by behavior changes.
- [Provider latching adds job metadata complexity] -> worth it to preserve auditability and stable retry semantics.

## Open Questions

- Whether the provider latch should be tracked only as a job field or also as attempt history metadata if retries later become provider-aware per attempt.
- Whether the admin settings panel should eventually surface a read-only note about the active Azure endpoint/deployment without exposing secrets.
