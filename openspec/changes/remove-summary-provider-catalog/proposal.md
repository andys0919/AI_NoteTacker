# Change: Remove the singleton summary-provider catalog

Tracking: [GitHub issue #9](https://github.com/andys0919/AI_NoteTacker/issues/9)

## Why

`SummaryProviderCatalog` wraps one fixed `local-codex` option, and its
environment factory reads no environment values. The canonical provider values
already live in `domain/summary-provider.ts`, so the extra catalog, injection
surface, and dedicated unit test add indirection without adding behavior.

## What Changes

- Delete the singleton summary-provider catalog and its dedicated unit test.
- Read the fixed primary provider and admin option directly from the existing
  summary-provider domain constants.
- Preserve the admin API payload, persisted `summaryProvider`, Local Codex job
  routing, historical Azure attribution, quota fallback, and cloud settlement.

## Impact

- Affected specs: `meeting-summary-generation`
- Affected code: control-plane app construction, persistence defaults, and
  focused control-plane tests
- Dependencies: none added or removed
