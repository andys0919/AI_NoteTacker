# Change: Add Admin Transcription Provider Switch

## Why
The current product hard-codes self-hosted `faster-whisper` as the only transcription engine. That matches the original MVP constraint, but it now blocks an operator need that is already clear: the system should be able to switch globally between the local GPU-backed Whisper path and an Azure OpenAI hosted transcription path without editing container env files or redeploying for every test.

At the same time, this cannot be implemented as a loose UI toggle. Provider choice changes system behavior, introduces a hosted dependency, and must keep Azure secrets server-side. The product therefore needs an explicit admin-managed provider setting, clear authorization boundaries, and a worker/runtime contract for choosing the correct transcription engine per job.

## What Changes
- Add an admin-only control plane setting for the global transcription provider.
- Support two provider choices in the first slice:
  - `self-hosted-whisper`
  - `azure-openai-gpt-4o-mini-transcribe`
- Keep Azure endpoint, deployment, and API key in server/worker environment only; never expose secrets to browser clients.
- Persist the selected provider in the system data plane so the active choice survives restarts.
- Update the transcription worker contract so each claimed job locks to the effective provider selected at transcription start.
- Extend the dashboard with a simple admin-only provider switch UI.
- Update the transcription pipeline requirements to allow an approved hosted provider instead of Whisper-only behavior.

## Impact
- Affected specs: `transcription-provider-management`, `whisper-transcription-pipeline`, `operator-dashboard`
- Affected code: control-plane admin/auth/config APIs, job domain/repository persistence, transcription worker provider factory/adapters, dashboard admin settings UI, environment/configuration docs
