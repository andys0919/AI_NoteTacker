## ADDED Requirements

### Requirement: Console layouts are responsive without page-level overflow
The operator dashboard and admin console SHALL adapt their layout to the available viewport while containing intrinsically wide content inside its owning component.

#### Scenario: Console is opened on a narrow viewport
- **WHEN** the operator dashboard or admin console is rendered at a 390 CSS pixel viewport
- **THEN** the primary shell fits within the viewport without page-level horizontal scrolling
- **AND** multi-column page regions collapse into a readable single-column flow
- **AND** wide admin tables scroll inside their table container instead of widening the page

#### Scenario: Console is opened on a desktop viewport
- **WHEN** the operator dashboard or admin console is rendered at 1024 CSS pixels or wider
- **THEN** the interface uses the available width for a clear task hierarchy
- **AND** primary actions, status, and working content remain visually distinct

### Requirement: Interactive console state is accessible and explicit
The console SHALL expose focus, selection, and asynchronous progress through visible and semantic state.

#### Scenario: Keyboard or touch user operates the console
- **WHEN** a user navigates interactive controls with a keyboard or touch input
- **THEN** keyboard focus is visibly indicated
- **AND** primary controls provide a practical target of at least 44 by 44 CSS pixels
- **AND** dashboard quick filters expose their selected state to assistive technology
- **AND** scripted scrolling respects the user's reduced-motion preference

#### Scenario: Primary form action is processing
- **WHEN** a meeting, upload, login, governance, quota, or history-refresh form is waiting for a response
- **THEN** the affected form exposes a busy state and visible progress text
- **AND** its submit control prevents duplicate submission until the request succeeds or fails
- **AND** unrelated page controls remain available

#### Scenario: Initial job loading fails
- **WHEN** the dashboard or owner detail request fails before any job content is
  available
- **THEN** the jobs region leaves its busy state and shows a clear unavailable
  message instead of retaining the loading placeholder

#### Scenario: Administrator opens contained detail or wide usage content
- **WHEN** an administrator opens job details or navigates the wide usage-history table
- **THEN** job details use a modal that contains keyboard focus until closed and restores focus to its trigger
- **AND** the usage-history scroll region is named and keyboard-focusable

#### Scenario: Quick filter has no match on the loaded page
- **WHEN** a dashboard quick filter has no matching job in the currently loaded page and the archive has another page
- **THEN** the dashboard explains that only the loaded records were checked
- **AND** the operator can load the next page without resetting the already loaded records

#### Scenario: Active job progress changes in the background
- **WHEN** a visible job remains active while the operator reads or expands another job
- **THEN** its stage, percentage, elapsed duration, and progress bar update automatically
- **AND** the dashboard does not repaint the full job list or reset unrelated expanded content, focus, or scroll position

### Requirement: Console surfaces contain only task-relevant context
The console SHALL use a content-first visual hierarchy, avoid duplicating fixed or already-visible information, and keep one clear navigation path for each page.

The transcript speaker-presentation clauses originally introduced by this
requirement are superseded by `refine-meeting-artifact-reader`; the current
reader contract omits stored speaker classification while preserving evidence.

#### Scenario: Operator opens the dashboard
- **WHEN** the operator dashboard loads in guest mode
- **THEN** it presents meeting intake, recording upload, jobs/archive, and the admin entry
- **AND** it does not repeat fixed guest-mode or default join-name information in separate summary cards
- **AND** recording intake does not expose an optional recognition-glossary field
- **AND** decorative background layers and repeated English eyebrow labels do not compete with the Chinese task labels
- **AND** terminal-history actions are hidden when no terminal record exists
- **AND** search, counters, and filters are hidden when the archive has no records
- **AND** an existing jobs/archive region appears before intake forms in the narrow single-column flow

#### Scenario: Job has no settled cost data
- **WHEN** a job has no positive priced cost and no recorded unpriced usage
- **THEN** the job card omits cost rows instead of displaying `$0.000`
- **AND** positive priced costs retain enough precision to remain non-zero
- **AND** recorded unpriced usage is labelled `未定價`

#### Scenario: Operator reads a long transcript
- **WHEN** an operator requests the full content of a job with a transcript
- **THEN** the job list does not preload the full transcript artifact
- **AND** background progress polling transfers only lightweight status and preview fields
- **AND** the transcript appears in one reader with distinct timestamp and wording fields
- **AND** stored speaker classification is omitted from the normal reader
- **AND** an identical leading anonymous speaker prefix is removed from the displayed wording
- **AND** empty segments and raw-recognition review evidence are omitted from the normal reading surface
- **AND** long-form summary and transcript prose remains at least `1rem` on narrow viewports
- **AND** the stored transcript artifact and its evidence remain unchanged

#### Scenario: Administrator opens the governance console
- **WHEN** an authenticated administrator views the governance console
- **THEN** one compact section navigation provides access to the maintained governance regions
- **AND** duplicated overview cards or topbars do not repeat the same navigation and section descriptions
