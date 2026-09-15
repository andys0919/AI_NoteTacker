## ADDED Requirements

### Requirement: Transcript reading can be narrowed to one speaker
The meeting reader SHALL let a reader show only the turns of a single speaker
without altering the stored transcript, its exports, or its speaker edits.

#### Scenario: Transcript has several speakers
- **WHEN** the transcript panel renders a transcript with two or more readable speakers
- **THEN** a filter group precedes the scrolling transcript
- **AND** it offers one control for all speakers plus one control per speaker
- **AND** each speaker control shows that speaker's display name and its segment count
- **AND** each speaker control carries the same tone as that speaker's chips in the transcript
- **AND** the control for all speakers is selected initially
- **AND** every control is a button exposing its selected state to assistive technology

#### Scenario: Reader selects one speaker
- **WHEN** a reader activates the control for one speaker
- **THEN** the transcript shows only the turns attributed to that speaker
- **AND** every other turn is hidden from both sight and assistive technology
- **AND** a status message states which speaker is shown and how many of the total segments that is
- **AND** activating the control for all speakers restores every turn

#### Scenario: Filtering never changes what is stored or exported
- **WHEN** a speaker filter is active
- **THEN** the transcript download and copy actions still produce the complete transcript
- **AND** the stored artifact, speaker names and per-segment reassignments are unchanged
- **AND** renaming or reassigning a speaker remains available from the visible turns

#### Scenario: Filter survives an edit-triggered re-render
- **GIVEN** a reader has selected one speaker
- **WHEN** a speaker rename or reassignment re-renders the reader
- **THEN** the same speaker remains selected
- **AND** the open tab and transcript scroll position are still preserved

#### Scenario: Transcript cannot be filtered
- **WHEN** a transcript has fewer than two readable speakers, or carries no speaker labels at all
- **THEN** no filter group is rendered
- **AND** the transcript renders exactly as it does today

### Requirement: Owned note pages read identically to the admin result page
An operator opening an owned note SHALL get the same reader layout, including
the split view and its sticky summary column, that the admin result page shows
for the same job.

#### Scenario: Owner opens a note on a wide screen
- **WHEN** an operator opens `/notes/:id` on a viewport at or above the split-layout breakpoint
- **THEN** the transcript and summary appear side by side, as they do on the admin result page
- **AND** no ancestor of the reader clips its content
- **AND** scrolling the transcript keeps the summary column pinned in view

#### Scenario: Both pages share one layout implementation
- **WHEN** the reader renders in detail layout on either page
- **THEN** the reader itself carries the marker its split-layout styles select on
- **AND** those styles are written once, against that marker, not per page
- **AND** the wide-layout switch reads the marker from the reader, so it works before the page attaches the card
