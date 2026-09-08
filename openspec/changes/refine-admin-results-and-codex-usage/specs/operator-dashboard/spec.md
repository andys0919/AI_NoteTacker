## ADDED Requirements

### Requirement: Weekly allowance comes from the credential-owning runtime
The system SHALL obtain the official Codex seven-day allowance from the runtime
that owns the active Codex login, through the existing authenticated internal
API boundary. It SHALL forward only validated allowance fields and observation
time to the administrator, without copying OAuth credentials to consumers.

#### Scenario: Summary worker has no local Codex login
- **WHEN** the central runtime reports an official 10,080-minute bucket
- **THEN** the admin shows its used percentage, remaining percentage, reset time,
  and actual observation time
- **AND** the summary worker does not launch a local Codex allowance process

#### Scenario: Allowance is unavailable or stale
- **WHEN** the probe fails, returns invalid data, omits the weekly bucket, or the
  last observation is more than three minutes old
- **THEN** the admin shows an explicit unavailable state
- **AND** does not substitute a five-hour window, inferred token usage, or a stale
  percentage with a new observation time

#### Scenario: An unauthenticated client requests allowance
- **WHEN** an internal caller lacks the existing API bearer token or a browser
  lacks administrator authentication
- **THEN** the corresponding API rejects the request without returning usage
- **AND** the central endpoint returns no OAuth material, account identifiers,
  credits, or unrelated account data even to authorized callers

### Requirement: Admin console contains the requested operational surfaces
The admin SHALL omit personal quota, recent governance changes, and today's
usage report, including their navigation entries and automatic data requests.
It SHALL preserve AI policy management, runtime health, weekly allowance, and
the per-job cost/result history, along with the underlying audit and cost data.

#### Scenario: Administrator opens the console
- **WHEN** the admin console finishes loading
- **THEN** the three removed sections and their navigation links are absent
- **AND** it makes no requests to their APIs
- **AND** the remaining settings still load and save correctly

### Requirement: Admin job history opens the final user document
The admin history SHALL list one row per job with a stored readable document
title, total spend, submitter, and an action that opens the full final document.
The document SHALL use the same summary and transcript projection and renderer
as the user's shared result page. Raw provider request details SHALL NOT be the
primary history action.

#### Scenario: Administrator opens a finished result
- **WHEN** a completed job has readable stored artifacts
- **THEN** its result action opens the full structured summary and transcript
- **AND** the history endpoint returns only lightweight result metadata
- **AND** viewing the result creates no public share link or new artifact copy

#### Scenario: Operator has hidden a finished job
- **WHEN** the operator clears their history but the artifacts remain stored
- **THEN** the administrator can still open the same final result

#### Scenario: Result is missing or unfinished
- **WHEN** artifacts were deleted, the job no longer exists, or it is unfinished
- **THEN** its costs remain visible with an explicit result status
- **AND** no usable final-result link is offered

#### Scenario: A non-admin requests a final result
- **WHEN** a caller lacks administrator authentication
- **THEN** the admin result API returns no document content
- **AND** existing public-share expiry, revocation, and owner access rules remain
  unchanged
