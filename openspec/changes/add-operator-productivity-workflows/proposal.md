# Change: Add Operator Productivity Workflows

## Why
The authenticated operator dashboard is now usable for core recording, transcription, and archive retrieval, but it still behaves like an operator console rather than a company-wide productivity tool. Teams still have to re-enter the same join-name conventions, manually reshape summary output for different departments, repeatedly sift through long archives, and copy results by hand into downstream chats or documents.

Production adoption across business, product, HR, and operations needs a faster end-to-end workflow: role-aware defaults at submission time, clearer notification options, archive filters that reduce scanning cost, and share actions that turn completed jobs into reusable outputs in one click.

## What Changes
- Add built-in dashboard submission templates for common company roles, including default join names, summary profiles, and preferred export/share defaults.
- Persist per-job workflow preferences so completed jobs can keep the template context that created them.
- Extend summary generation so the Codex summarizer can follow a requested summary profile instead of always using the same generic framing.
- Add archive quick filters and deep-linkable job links so operators can reopen relevant work faster.
- Add share actions that let operators copy the summary, copy key points, and copy a stable job link.
- Surface notification status in the dashboard and add optional browser notifications for terminal job outcomes while keeping existing email notifications.
- Align deployment defaults so local environments prefer GPU Whisper plus Codex CLI summaries, while cloud environments default to Azure OpenAI transcription and `gpt-5.1-mini` summaries unless overridden.

## Impact
- Affected specs: `operator-dashboard`, `operator-notifications`, `meeting-summary-generation`
- Affected code: dashboard frontend, operator config/jobs APIs, recording job domain + persistence, archive rendering helpers, transcription worker summary prompt handling, related tests
