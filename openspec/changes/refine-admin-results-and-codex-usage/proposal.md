# Change: Restore official Codex usage and make admin history show final results

## Why

The admin allowance probe still runs in a summary worker that no longer owns
Codex login state. The central runtime successfully returns the official
Business seven-day window. Admin history also emphasizes provider requests
instead of the finished document delivered to the user.

## What Changes

- Read official `account/rateLimits/read` in the credential-owning runtime and
  expose a bounded, authenticated, sanitized usage response. The summary worker
  forwards its seven-day snapshot through the existing claim heartbeat.
- Remove personal quota, recent governance changes, and today's usage report
  from the admin UI and its startup requests, while preserving backend records.
- Show each job's stored document title, total cost, submitter, and final-result
  action. Reuse the user's full shared-document renderer behind admin auth.
- Preserve hidden jobs for admin viewing, and show unavailable states for
  deleted or unfinished results without creating public share links.

## Impact

Ticket: https://github.com/andys0919/AI_NoteTacker/issues/10

- Specs: `operator-dashboard`, plus the existing weekly-allowance contract.
- Code: control-plane admin/API and shared reader, summary-worker usage probe,
  and the central runtime's existing authenticated HTTP entrypoint.
- No new dependencies, OAuth copies, public access grants, or database schema.
- Review baseline: `c61f358aafb5029b1a7bc720e75a99eae462fc4a` plus only the
  explicitly scoped central runtime changes; preserve existing unrelated WIP.
- The user's explicit spec → ticket → implementation → code review request
  authorizes implementation of these requirements after recording this spec.

## Evidence before implementation

- Summary worker: no Codex OAuth state; local probe reports `probe-failed`.
- Central runtime: official RPC returns `planType=team`, including a
  `windowDurationMins=10080` bucket with usage and reset time.
- Existing final documents are persisted in recording job artifacts and already
  rendered through `toPublicMeeting()` and `share.js`.
