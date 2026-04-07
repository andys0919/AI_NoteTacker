# Change: Add Codex Transcript Summaries

## Why
Transcript generation is now operational, but operators still need a concise summary derived from the transcript. The project currently stops at recording and Whisper transcription, which leaves the final output too verbose for practical note-taking workflows.

## What Changes
- Add a derived summary artifact generated from completed transcripts.
- Extend the summary artifact with structured sections for action items, decisions, risks, and open questions while keeping Markdown text output.
- Use Codex-backed summarization with model `gpt-5.3-codex-spark` and reasoning effort `medium`.
- Extend the job result payload so operators can retrieve both transcript and summary output.
- Wire the screenapp stack so summary generation can run inside the worker environment using existing Codex authentication from the host machine.

## Impact
- Affected specs: `meeting-summary-generation`
- Affected code: control-plane job domain/API/persistence, transcription worker pipeline, Docker compose/runtime configuration
