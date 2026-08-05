## ADDED Requirements

### Requirement: Archive retrieval remains lightweight through persistence
The operator archive SHALL retrieve lightweight list records from the
repository and SHALL reserve complete recording, transcript, and summary
artifacts for an explicitly requested per-job detail response.

#### Scenario: Operator lists or searches PostgreSQL archive records
- **WHEN** the operator requests an archive page or searches owned jobs
- **THEN** the PostgreSQL result projection excludes `recording_artifact`, `transcript_artifact`, and `summary_artifact`
- **AND** the list result retains the existing metadata, transcript and summary previews, and artifact-presence flags
- **AND** content search is evaluated without transferring complete artifact JSON into Node.js
- **AND** pagination order and cursor behavior remain unchanged
- **AND** the equivalent in-memory repository returns the same lightweight list shape
- **AND** an owned per-job detail request still returns the complete stored artifacts

#### Scenario: Historical artifacts predate stored list previews
- **GIVEN** a historical PostgreSQL job has transcript or summary artifacts and its corresponding preview is null
- **WHEN** the recording-job schema migration runs
- **THEN** it idempotently stores transcript and summary previews using the current list-preview trimming, segment, and length rules
- **AND** it does not modify the complete stored artifacts

#### Scenario: Archive records exclude active lease credentials
- **WHEN** the operator lists or searches owned jobs
- **THEN** the list item contract excludes `recordingLeaseToken`, `transcriptionLeaseToken`, and `summaryLeaseToken`
- **AND** the PostgreSQL projection excludes `recording_lease_token`, `transcription_lease_token`, and `summary_lease_token`
- **AND** the equivalent in-memory list mapper excludes the same credentials

### Requirement: Completed meeting artifacts use distinct reading modes
The operator dashboard SHALL present completed summary and transcript artifacts
as separate long-form reading modes after explicit detail retrieval.

#### Scenario: Completed job contains summary and transcript
- **WHEN** an operator requests the complete content of a job with both artifacts
- **THEN** the reader presents explicit `摘要` and `逐字稿` tabs
- **AND** only the selected artifact panel is visible
- **AND** the summary is selected initially
- **AND** tab selection and panel ownership are exposed to assistive technology

#### Scenario: Completed job contains only one artifact
- **WHEN** an operator requests a job with only a summary or only a transcript
- **THEN** the available artifact is selected and readable
- **AND** the reader does not render an empty competing panel

### Requirement: Summary reader is structured and content faithful
The operator dashboard SHALL render supported summary content as a readable
article and SHALL omit unsupported or empty presentation filler.

#### Scenario: Topic-based summary is displayed
- **WHEN** a stored summary contains content-derived topics
- **THEN** the reader shows an overview followed by topic headings, supported points, status, and conclusion
- **AND** it shows only non-empty follow-up, decision, risk, and unresolved-question sections
- **AND** desktop readers can navigate the available article sections from a table of contents
- **AND** no placeholder date, location, participant, or empty-section message is invented

#### Scenario: Historical flat summary is displayed
- **WHEN** a historical artifact has no topic collection
- **THEN** its overview and existing non-empty flat sections use the same article hierarchy
- **AND** the reader remains compatible without regenerating the summary

### Requirement: Transcript reader separates timing context from wording
The operator dashboard SHALL render every non-empty transcript segment with
distinct timestamp and transcript wording fields without speaker classification.

#### Scenario: Historical segment has stored speaker evidence
- **WHEN** a historical transcript segment contains an anonymous speaker label
- **THEN** the reader omits that speaker classification
- **AND** a duplicated leading speaker prefix is removed from the wording
- **AND** raw-recognition text and review evidence are not shown in the normal reader

#### Scenario: Historical summary wording contains anonymous speaker labels
- **WHEN** a historical summary contains `Speaker A`, `Speaker B`, or another anonymous `Speaker` classification
- **THEN** operator and admin readers replace the classification with the neutral wording `與會者`
- **AND** Markdown and text exports use the same neutral wording
- **AND** stored artifacts and JSON evidence exports remain unchanged

#### Scenario: Segment has no speaker evidence
- **WHEN** a transcript segment has no supported speaker metadata, including a
  historical segment whose wording still starts with an anonymous `Speaker` code
- **THEN** its timestamp and wording remain readable
- **AND** the dashboard does not add a speaker classification
- **AND** a leading anonymous `Speaker` code is not rendered as transcript wording

### Requirement: Long-form reader remains responsive and bounded
The operator dashboard SHALL preserve readable line length and contain long
artifacts without causing page-level horizontal overflow.

#### Scenario: Reader is opened on desktop
- **WHEN** the viewport is at least 1024 CSS pixels wide
- **THEN** the summary article and available-section navigation have distinct columns
- **AND** transcript content remains within a readable line length
- **AND** the dedicated owner transcript remains inside one named, keyboard-focusable vertical scroll region instead of extending the page by its full segment count

#### Scenario: Reader is opened at 390 CSS pixels
- **WHEN** the viewport is 390 CSS pixels wide
- **THEN** summary navigation and content collapse into one column
- **AND** transcript timestamp and wording remain legible
- **AND** the dedicated owner transcript remains vertically bounded and scrollable
- **AND** the page has no horizontal overflow
