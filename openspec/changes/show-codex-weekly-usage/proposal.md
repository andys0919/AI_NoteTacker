# Change: Show Codex weekly usage in admin settings

## Why

Administrators can see Local Codex as the active summary route but cannot see
the subscription allowance reported by that account. They need the current
seven-day usage, remaining percentage, and reset time before the worker reaches
its limit.

## What Changes

- Reuse Codex app-server `account/rateLimits/read` in the summary worker.
- Report only a sanitized seven-day snapshot to the control plane; never expose
  OAuth material, account identifiers, or opaque reset-credit IDs.
- Add an authenticated admin API and a compact Codex weekly-usage panel.
- Show an explicit unavailable state when Codex does not return a seven-day
  window instead of estimating or substituting a shorter window.

## Impact

- Affected specs: `operator-dashboard`
- Affected code: summary-worker Codex probe and claim client, control-plane
  admin/worker routes, static admin UI, and focused tests
- Data migration: none; the latest snapshot is runtime state and is refreshed
  by the existing summary-worker polling loop
