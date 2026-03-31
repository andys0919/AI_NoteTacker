# Change: Extract Reusable Meeting AI Pipeline Package

## Why
The repository now has a working GPU Whisper transcription path plus Codex-based transcript summarization, but that capability is still embedded inside the `transcription-worker` implementation. Other projects cannot reuse it cleanly without copying worker-specific code.

## What Changes
- Extract the reusable download, transcription, summarization, and pipeline orchestration logic into a standalone Python package inside this repository.
- Keep `transcription-worker` as a thin adapter around the shared package.
- Add packaging metadata and local integration so other projects can import the shared package directly.
- Preserve existing behavior for the current control-plane/worker stack.

## Impact
- Affected specs: `meeting-ai-pipeline-package`
- Affected code: Python worker package layout, Docker/runtime wiring, test and build scripts
