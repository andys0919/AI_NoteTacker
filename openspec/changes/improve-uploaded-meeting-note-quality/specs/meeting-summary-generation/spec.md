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

#### Scenario: Transcript contains aligned anonymous speaker evidence
- **WHEN** a primary transcript segment has an alignment-gated anonymous speaker label
- **THEN** the summary prompt prefixes that label to the unchanged primary wording
- **AND** it forbids inferring a real identity from the anonymous label

#### Scenario: A discussed choice remains pending
- **WHEN** the transcript presents a tentative or contested choice and later assigns confirmation of that same point
- **THEN** the summary keeps the point out of `decisions`
- **AND** it may report the explicit confirmation assignment as an action item and the unresolved choice as an open question
