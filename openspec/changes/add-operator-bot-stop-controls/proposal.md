# Change: Add Operator Bot Stop Controls

## Why
Operators need a way to stop their currently running meeting bot when it should leave a meeting immediately. The dashboard also currently shows jobs as `joining` even after the meeting bot has actually entered and started recording, which causes confusion.

## What Changes
- Add an operator action to stop the current active meeting bot for that operator.
- Let an operator-requested bot exit finalize the current recording and continue into transcription when possible, instead of forcing an immediate failed outcome.
- Expose a runtime-aware display state so the dashboard can show `recording` when the meeting bot is already active.

## Impact
- Affected specs: `operator-dashboard`
- Affected code: control-plane operator APIs, meeting-bot runtime integration, dashboard UI
