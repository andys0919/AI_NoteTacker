## ADDED Requirements

### Requirement: Owners control one time-bounded bearer link per meeting
The system SHALL let a job owner manage at most one active no-login share link
for an eligible completed job.

#### Scenario: Owner creates or copies an eligible share link
- **WHEN** the owner requests a share link for a completed job containing a
  transcript or summary
- **THEN** the system creates a cryptographically unguessable bearer link or
  returns the existing valid link
- **AND** the link expires exactly 30 days after its creation
- **AND** no recipient account or login is required

#### Scenario: Owner rotates a share link
- **WHEN** the owner explicitly confirms rotation
- **THEN** the previous bearer credential becomes invalid before a new link is
  returned
- **AND** the replacement receives a new 30-day lifetime

#### Scenario: Owner revokes a share link
- **WHEN** the owner revokes the current link
- **THEN** later requests using that credential cannot retrieve meeting content
- **AND** the job and its owner-only artifacts remain unchanged

#### Scenario: Ineligible or non-owner creation is attempted
- **WHEN** a requester does not own the job or the job is not completed with a
  readable artifact
- **THEN** the system does not create or disclose a share credential
- **AND** an empty artifact shell without readable summary or transcript text
  remains ineligible

#### Scenario: Owner reviews sharing controls
- **WHEN** the owner opens a meeting detail page
- **THEN** the owner-detail API projects the server-owned eligibility decision
- **AND** the page explains when the meeting becomes eligible for sharing
- **AND** eligible controls state that anyone holding the bearer URL can view
  and forward it, and that the URL expires or can be rotated or revoked

### Requirement: Share credentials are fail-closed and kept out of public URLs sent to servers
The system SHALL sign share credentials with a dedicated secret, avoid storing
the bearer signature, and keep the credential out of request paths and query
strings.

#### Scenario: Valid shared URL is opened
- **WHEN** a recipient opens `/share#<token>`
- **THEN** the browser sends only `/share` in the initial HTTP request
- **AND** first-party JavaScript sends the token to the public data API through
  an authorization header
- **AND** the credential is not placed in a path, query string, analytics event,
  or DOM text

#### Scenario: Share signing secret is unavailable
- **WHEN** the dedicated share signing secret is absent or shorter than 32
  UTF-8 bytes
- **THEN** share creation and verification fail closed
- **AND** the system does not fall back to an internal, admin, or operator
  credential

#### Scenario: Invalid share credential is presented
- **WHEN** a token is malformed, expired, revoked, rotated, hidden, deleted, or
  otherwise invalid
- **THEN** the public API returns one generic unavailable outcome
- **AND** it does not reveal whether the job or share record exists

### Requirement: Public meeting responses use an allowlisted current-content projection
The public share API SHALL construct a dedicated response containing only
approved current meeting content.

#### Scenario: Valid recipient opens shared meeting
- **WHEN** a valid unexpired token resolves to a visible eligible job
- **THEN** the response may include a safe title, meeting date, duration,
  summary, supported structured sections, readable transcript segments,
  and timestamps
- **AND** stored speaker metadata and leading anonymous speaker codes are
  omitted as in the owner reader
- **AND** later canonical summary or transcript corrections appear on the same
  share URL

#### Scenario: Current structured summary is projected

- **WHEN** the current summary artifact contains a structured summary payload
- **THEN** the public response includes only the sanitized allowlisted
  structured summary fields
- **AND** it omits the complete rendered `summary.text` because that text may
  contain non-public analysis notes
- **AND** it omits `analysisNotes`

#### Scenario: Historical flat summary is projected

- **WHEN** a historical summary artifact has no structured summary payload
- **THEN** the public response may include its sanitized summary text
- **AND** anonymous speaker labels remain omitted

#### Scenario: Public projection is serialized
- **WHEN** the system builds a public meeting response
- **THEN** it excludes job and submitter identity, source URL or filename,
  passcode, costs, providers, models, workers, leases, quotas, internal history,
  failure details, notification metadata, raw media, artifact download URLs,
  raw recognition text, review flags, recognition evidence, and structured
  `analysisNotes`
- **AND** the browser never receives a full operator or admin job DTO from the
  public endpoint

#### Scenario: Public caller tries the raw worker job lookup
- **WHEN** a caller requests a raw recording job by ID without a valid internal
  service credential
- **THEN** the request is rejected before job content is returned
- **AND** the full worker DTO cannot act as an alternate public sharing route

#### Scenario: Owner hides or deletes the meeting record
- **WHEN** the owner hides, deletes, or clears the shared terminal record
- **THEN** public resolution immediately stops returning its meeting content
- **AND** the repository operation also revokes the matching share lifecycle
  row without loading every complete artifact into the router
- **AND** access remains closed even if separate share-row cleanup is delayed

### Requirement: Public meeting pages are read-only, accessible, and private by default
The public meeting page SHALL provide a complete readable experience without
job mutation or unintended redistribution features.

#### Scenario: Recipient reads shared content
- **WHEN** a recipient opens a valid shared meeting
- **THEN** the page presents semantic summary and transcript reading regions
- **AND** text remains selectable and copyable
- **AND** native browser printing remains available
- **AND** no edit, comment, regeneration, job-control, raw-media, or artifact
  export action is offered

#### Scenario: Shared page or data is delivered
- **WHEN** the server returns public share HTML or meeting data
- **THEN** responses prohibit storage through `Cache-Control: private, no-store`
- **AND** indexing and archiving are prohibited
- **AND** referrer disclosure is disabled
- **AND** a restrictive same-origin content security policy is applied
- **AND** the page loads no third-party font, script, image, analytics, or embed

#### Scenario: Recipient uses a narrow viewport or keyboard
- **WHEN** the shared page is used at 390 CSS pixels or with keyboard navigation
- **THEN** it has no page-level horizontal overflow
- **AND** headings, skip navigation, focus order, and focus indicators remain
  accessible
- **AND** readable content does not depend on hover, color alone, or animation

#### Scenario: Recipient has JavaScript disabled
- **WHEN** the share shell cannot execute its first-party JavaScript
- **THEN** the static page explains that JavaScript is required to retrieve the
  fragment-authorized meeting safely
