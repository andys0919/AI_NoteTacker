# Change: Add Admin Summary Model Switch

## Why
The cloud summary path is now wired to Azure OpenAI, but the effective summary model is still configured only through environment variables and container restarts. That is too rigid for day-to-day tuning. Administrators need to be able to input a different summary model name, such as `gpt-5.4-nano`, and have future summaries use it immediately.

## What Changes
- Add an admin-only summary model setting API that reads and updates the current summary model string.
- Persist the current summary model in control-plane settings storage alongside the global transcription provider.
- Propagate the current summary model to newly claimed transcription jobs so workers can use it without restarting.
- Update the admin dashboard to expose a free-form summary model input and apply action.

## Impact
- Affected specs: `operator-dashboard`, `meeting-summary-generation`
- Affected code: control-plane settings persistence, admin APIs, transcription claim payloads, transcription worker summarizer overrides, dashboard admin UI
