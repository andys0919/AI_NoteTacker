# Change: Remove Daily Cloud Quota Enforcement

## Why
Daily cloud budget values can become negative and currently reject new meeting
or upload jobs. This deployment should continue recording cloud usage without
using the configured daily amount as a submission limit.

## What Changes
- Accept supported meeting-link and uploaded-media jobs regardless of the
  submitter's remaining daily cloud budget.
- Keep submission-time provider snapshots, reservation estimates, quota-day
  identity, immutable usage settlement, and cost reporting.
- Treat daily cloud budget and remaining values as informational.

## Impact
- Affected spec: `cloud-usage-governance`
- Affected code: control-plane submission policy and quota integration tests
- Supersedes the rejection behavior introduced by
  `add-cloud-usage-governance`.
