## MODIFIED Requirements

### Requirement: On-demand heavy archive detail retrieval
The system SHALL return full transcript and summary bodies only through
explicit, owner-scoped per-job detail or export retrieval paths.

#### Scenario: Operator opens one owned job
- **WHEN** an operator activates the complete-content link for one owned job
- **THEN** the browser opens `/notes/:jobId` as a separate tab
- **AND** the page retrieves and displays the complete user-facing detail for
  that job
- **AND** the archive list and polling paths remain lightweight
- **AND** the link is explicitly labelled as opening a separate tab
- **AND** the dashboard does not fetch or render full artifacts inline beneath
  the archive card

#### Scenario: Operator opens a non-completed owned job
- **WHEN** an operator opens the detail page for a queued, active, or failed job
- **THEN** the page displays its current status, progress, and available
  user-facing detail
- **AND** missing transcript or summary content is not fabricated

#### Scenario: Operator requests another owner's job page
- **WHEN** an operator requests `/notes/:jobId` for a job they do not own
- **THEN** the system returns the same not-found outcome used for a nonexistent
  job
- **AND** no job metadata or artifact content is disclosed

## ADDED Requirements

### Requirement: Console surfaces use a contemporary content-first visual system
The operator dashboard, admin console, owner detail page, and public share page
SHALL use a consistent monochrome layered dark system with high-contrast
semantic surfaces and controls. The console SHALL prioritize scanning and
action, while meeting-reading pages SHALL prioritize long-form content.

#### Scenario: Console or reading page is displayed
- **WHEN** any maintained console or meeting-reading surface is rendered
- **THEN** its page uses the approved near-black canvas, separated charcoal
  surfaces, bright neutral text, and white primary action tokens
- **AND** icons and decorative treatments remain black, charcoal, gray, or white
- **AND** chromatic color is reserved for destructive-error semantics
- **AND** primary text and controls meet at least WCAG AA contrast
- **AND** content hierarchy uses spacing, scale, visible borders, and a
  consistent elevation system rather than low-contrast decoration
- **AND** the page does not use one flat `#000000` layer for canvas and content
- **AND** focus remains visible without relying on color alone

#### Scenario: Long meeting content is read
- **WHEN** a summary or transcript is displayed on desktop or mobile
- **THEN** prose uses a bounded readable line length and at least 16px base text
- **AND** the layout has no page-level horizontal overflow at 390 CSS pixels
- **AND** motion respects `prefers-reduced-motion`

### Requirement: Eligible owner detail pages expose share management
An owner detail page SHALL expose public share management only when the job is
completed and contains a transcript or summary.

#### Scenario: Eligible completed job is opened
- **WHEN** the owner opens a completed job with at least one readable artifact
- **THEN** the page shows the current share status and expiry
- **AND** the owner can create or copy, rotate, and revoke the link
- **AND** pending actions prevent duplicate submission and expose visible status

#### Scenario: Ineligible job is opened
- **WHEN** the owner opens a queued, active, failed, or artifact-empty job
- **THEN** the page does not offer public link creation
- **AND** it explains that sharing becomes available only for completed readable
  content

### Requirement: Operator meeting cards show one aggregate cost
The operator dashboard and owner detail page SHALL show at most one aggregate
meeting cost while the admin console retains stage-level usage detail.

#### Scenario: A meeting has settled cost
- **WHEN** an operator views a meeting card or owner detail page
- **THEN** the page labels the aggregate as `總費用`
- **AND** it does not separately display transcription, punctuation, or summary
  costs

#### Scenario: Part or all of the meeting usage is unpriced
- **WHEN** the aggregate cannot represent a fully priced total
- **THEN** the single `總費用` value preserves the unpriced warning
- **AND** it is not displayed as a settled zero
