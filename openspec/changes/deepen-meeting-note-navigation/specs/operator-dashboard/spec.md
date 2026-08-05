## ADDED Requirements

### Requirement: Summary navigation exposes the complete visible hierarchy
The operator summary reader SHALL expose stable in-page links for every visible
summary section, topic, subtopic, and grouped follow-up.

#### Scenario: Owner reads a hierarchical summary
- **WHEN** a stored summary contains topics and subtopics
- **THEN** the summary navigation nests topic links under the meeting-notes
  section and subtopic links under their owning topic
- **AND** grouped follow-up links are nested under the follow-up section
- **AND** every link targets the corresponding visible heading
- **AND** opening the owner URL with one of those fragments restores that target
  after the artifact is rendered
- **AND** keyboard focus moves to the restored target

#### Scenario: One visible top-level section contains nested topics
- **WHEN** the summary renders only one top-level section but that section has
  visible nested topics or subtopics
- **THEN** the table of contents remains available for those nested targets

#### Scenario: Topics are reordered
- **WHEN** an existing topic or subtopic is rendered at a different array
  position without changing its semantic content
- **THEN** its target ID remains unchanged
- **AND** a target whose semantic content changes becomes unavailable at its old
  ID rather than silently pointing to different visible content

#### Scenario: Visible items share a title
- **WHEN** two topics, subtopics, or grouped follow-ups have the same title but
  different semantic content
- **THEN** each receives a distinct target ID derived from its own content
- **AND** reordering them does not exchange their target IDs

#### Scenario: Owner scrolls a long summary
- **WHEN** the desktop summary is taller than the viewport
- **THEN** the table of contents remains sticky and reachable while the article
  scrolls
- **AND** ancestor overflow does not disable sticky positioning
- **AND** navigation does not introduce a second independently scrolling region

#### Scenario: Owner opens a dedicated meeting page
- **WHEN** the job detail loads
- **THEN** the browser-tab title uses the structured meeting title when present
- **AND** otherwise falls back to the uploaded source filename or `會議紀錄`
- **AND** the same meeting title is the visible page heading
- **AND** the artifact headings continue sequentially from that page heading
- **AND** collapsed job metadata and management actions occupy one compact
  control immediately before the artifact reader

#### Scenario: Owner keeps an active detail page open until completion
- **WHEN** a queued or active job becomes completed while its owner detail page
  remains open
- **THEN** detail polling retrieves the full owner-scoped job snapshot
- **AND** newly available transcript or summary content appears without a manual
  reload
- **AND** dashboard-list polling remains lightweight

#### Scenario: Owner reads on a narrow viewport
- **WHEN** the reader is opened at 390 CSS pixels
- **THEN** the nested navigation and article remain in one readable column
- **AND** links remain keyboard accessible
- **AND** the page has no horizontal overflow

#### Scenario: Owner crosses the responsive breakpoint
- **WHEN** the viewport changes between wider and narrower than 920 CSS pixels
- **THEN** the native table-of-contents disclosure updates between expanded and
  collapsed defaults
