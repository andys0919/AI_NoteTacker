## ADDED Requirements

### Requirement: Azure summary HTTP 400 retry is bounded and observable
The system SHALL retry an Azure Responses summary HTTP 400 exactly once with the identical request and SHALL NOT generalize that exception to other summary or punctuation failures.

#### Scenario: First summary request returns HTTP 400 and retry succeeds
- **WHEN** Azure returns HTTP 400 for a summary request
- **AND** the identical request succeeds on the next call
- **THEN** the job stores the valid summary artifact
- **AND** summary usage records two provider requests and one request without trustworthy usage
- **AND** the attempt remains unpriced unless usage for every request is authoritative

#### Scenario: Summary retry also returns HTTP 400
- **WHEN** Azure returns HTTP 400 for both the initial summary request and its one retry
- **THEN** the job records `summary-failed`
- **AND** the failure message states that one retry was exhausted
- **AND** it preserves the final Azure error body
- **AND** it does not issue a third provider request

#### Scenario: Summary fails for another reason
- **WHEN** a summary request times out or returns a non-400 HTTP error
- **THEN** the provider call fails without this retry
- **AND** punctuation requests never use the summary HTTP 400 retry policy

### Requirement: External note quality comparisons remain evidence based
The system SHALL compare summary candidates against transcript evidence and SHALL report comparison dimensions separately instead of treating an external generated summary as ground truth.

#### Scenario: Candidate summary is compared with PLAUD
- **WHEN** the same meeting is summarized by the local pipeline and PLAUD
- **THEN** the comparison reports transcript coverage, verified terminology, speaker attribution, unsupported claims, latency, request counts, and unpriced usage separately
- **AND** pending discussions are not counted as correct decisions merely because PLAUD promoted them

### Requirement: Summary prompts preserve verified and unresolved state
The system SHALL use operator-verified display terminology as accepted summary input and SHALL reserve decisions for explicitly settled meeting outcomes.

#### Scenario: Transcript contains an operator-verified alias correction
- **WHEN** immutable raw text and corrected display text are linked by `operator-verified-alias` evidence
- **THEN** the summary prompt uses the corrected display text
- **AND** it does not relabel that accepted correction as an unconfirmed review candidate

#### Scenario: A historical transcript contains anonymous speaker metadata
- **WHEN** a primary transcript segment contains a stored anonymous speaker label
- **THEN** the summary prompt omits the speaker label
- **AND** it strips an identical leading label from the wording before summarization
- **AND** the underlying historical artifact remains compatible

#### Scenario: A discussed choice remains pending
- **WHEN** the transcript presents a tentative or contested choice and later assigns confirmation of that same point
- **THEN** the summary keeps the point out of `decisions`
- **AND** it may report the explicit confirmation assignment as an action item and the unresolved choice as an open question

### Requirement: Summary structure is generic, topical, and evidence faithful
The system SHALL organize supported meeting content into content-derived topics without embedding benchmark-specific topic names, omitting later material discussion, or promoting unresolved discussion to a conclusion.

#### Scenario: A meeting contains settled and unresolved topics
- **WHEN** a summary is generated from a transcript containing both settled and pending discussion
- **THEN** each generated topic has a transcript-derived title, supported points, an explicit conclusion, and status `confirmed`, `mixed`, or `open`
- **AND** `mixed` or `open` topics retain pending approval, implementation, or evidence gaps
- **AND** the prompt contains no PLAUD answer, HDD-specific topic, phrase list, or fixed meeting-specific outline

#### Scenario: A long meeting changes subjects throughout the recording
- **WHEN** material discussion appears in the beginning, middle, and final third of a transcript
- **THEN** the summary covers each distinct material topic exactly once
- **AND** repeated discussion of the same subject is grouped
- **AND** distinct process, requirement, exception, dependency, scope, schedule, or outcome discussions remain distinguishable
- **AND** unresolved or out-of-scope discussion is retained with `mixed` or `open` status instead of being omitted

#### Scenario: Supported items require flat classification
- **WHEN** the transcript explicitly contains an assignment, final agreement, adverse impact, blocker, dependency, unresolved choice, missing input, or pending approval
- **THEN** the matching item appears in `action_items`, `decisions`, `risks`, or `open_questions`
- **AND** an action owner or deadline is included only when explicitly stated
- **AND** a topic may repeat the supported fact for narrative context without causing the fact to appear in unrelated flat sections

#### Scenario: A structured summary is displayed
- **WHEN** a stored summary contains topic structure and one or more non-empty structured sections
- **THEN** the operator sees a summary overview followed by topic-based meeting notes and their status
- **AND** only non-empty follow-up, decision, risk, and open-question sections are rendered
- **AND** no placeholder meeting information or empty-section filler is displayed

#### Scenario: A historical summary has no topics
- **WHEN** a historical summary artifact contains the existing flat structured fields without `topics`
- **THEN** the operator can still read its overview and non-empty structured sections
- **AND** export and sharing remain compatible with the existing fields

### Requirement: Summary prose is fluent, hierarchical, and non-duplicative
The system SHALL produce a fluent Traditional Chinese meeting article in one summary-model request and SHALL derive backward-compatible flat fields from that canonical hierarchy without a separate transcript-polishing or summary-rewrite request.

#### Scenario: Fragmented spoken discussion covers one decision domain
- **WHEN** transcript segments contain filler, repetition, interruptions, examples, requirements, and exceptions about the same decision domain
- **THEN** the summary rewrites the supported meaning as grammatically complete prose
- **AND** it creates one content-derived main topic for that decision domain
- **AND** it organizes related functions, screens, exceptions, and examples as subtopics rather than duplicate main topics
- **AND** no target, minimum, or maximum topic count appears in the prompt

#### Scenario: Follow-up work is classified
- **WHEN** the transcript explicitly requests or commits a confirmation, modification, test, reply, delivery, or other follow-up
- **THEN** the item appears in a follow-up group associated with its deliverable or dependency
- **AND** its owner or deadline appears only when explicitly stated
- **AND** a requirement, design conclusion, or useful suggestion without an explicit follow-up commitment does not become an action item

#### Scenario: Technical wording is inconsistent
- **WHEN** a technical name or identifier is contradictory, incoherent, or cannot be confirmed from transcript evidence
- **THEN** the summary uses the supported functional description
- **AND** it does not select, correct, or invent one candidate term

#### Scenario: Analysis notes share one root cause
- **WHEN** multiple unresolved gaps, dependencies, contradictions, or stated adverse impacts have the same root cause
- **THEN** the summary merges them into one concise analysis note
- **AND** it does not invent a solution or repeat the same fact across analysis, risk, and open-question sections without a distinct reading purpose

#### Scenario: A new hierarchical summary is stored and displayed
- **WHEN** the summary provider returns title, overview, topic/subtopic hierarchy, grouped follow-ups, classifications, and analysis notes
- **THEN** the worker derives compatible `points`, `keyPoints`, and `actionItems`
- **AND** the control plane stores both the hierarchy and compatible flat fields
- **AND** the operator reader displays the hierarchy and only supported non-empty sections
- **AND** historical flat or topic-with-points summaries remain readable

#### Scenario: A long Luna summary request exceeds five minutes
- **WHEN** one valid Luna/high summary request remains active longer than 300 seconds
- **THEN** the worker allows that request up to the configured 900-second socket timeout
- **AND** it does not issue a timeout retry or a second summary rewrite request
