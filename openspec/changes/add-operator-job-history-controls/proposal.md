# Change: Add Operator Job History Controls

## Why
The operator dashboard currently keeps every terminal job visible for as long as the browser keeps the same anonymous operator ID. Old failed and completed jobs quickly clutter the queue view, and operators have no supported way to remove stale history without manually changing browser storage or deleting rows from PostgreSQL.

## What Changes
- Add operator-facing APIs to delete a single terminal job owned by the current operator.
- Add an operator-facing API to clear all terminal job history for the current operator in one action.
- Reject delete attempts for non-terminal jobs so active queue and worker coordination stay intact.
- Update the dashboard to show per-job delete controls plus a bulk clear-history action.
- Limit this change to metadata/history cleanup; stored recording and transcript artifacts remain untouched.

## Impact
- Affected specs: `operator-dashboard`
- Affected code: control-plane repository/API/frontend tests and static dashboard assets
