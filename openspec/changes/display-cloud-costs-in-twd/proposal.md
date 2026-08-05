# Change: Display Cloud Costs in New Taiwan Dollars

## Why
Operators currently see USD amounts even though this Taiwan deployment is
managed in New Taiwan dollars. The displayed conversion also needs a dated,
verifiable price source instead of an unexplained exchange-rate guess.

## What Changes
- Keep the immutable usage ledger, settlement, reservations, and API contracts
  in USD.
- Convert every operator and admin monetary display to TWD through one shared
  formatter.
- Use the latest verified Azure Retail Prices API TWD reference snapshot and
  refresh it with the exact USD/TWD meter at control-plane startup and every
  24 hours.
- Return the current verified conversion reference in operator configuration so
  operator and admin pages apply the same rate before rendering costs.
- Preserve `未定價` and partial-price warnings instead of presenting a converted
  known subtotal as a complete bill.
- Let admins edit quota amounts in TWD while converting submissions back to the
  existing USD API precision.

## Impact
- Affected specs: `cloud-usage-governance`, `operator-dashboard`
- Affected code: the control-plane Azure Retail Prices adapter, mutable pricing
  catalog and TWD-reference domain state, startup refresh, operator-config API,
  dashboard/admin currency formatting and copy, and focused adapter/API/UI tests
- No database migration, ledger mutation, dependency, commit, push, release,
  archive, or pull request is included
