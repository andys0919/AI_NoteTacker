## ADDED Requirements

### Requirement: Transcript artifacts preserve raw recognition evidence
The system SHALL retain the speech-recognition provider's original text separately from derived display text and SHALL keep existing transcript consumers compatible.

#### Scenario: New transcript segment is persisted
- **WHEN** the speech-recognition provider returns text for an audio span
- **THEN** the stored segment retains that exact provider text as immutable raw text
- **AND** it stores the derived display text separately
- **AND** the legacy segment text field remains readable as the display-compatible value

#### Scenario: Legacy transcript artifact is read
- **WHEN** a stored segment has only the legacy text, start, and end fields
- **THEN** job detail and export continue to render that segment
- **AND** the system does not fabricate raw-text or language confidence that was never stored

### Requirement: Spoken languages remain untranslated
The system SHALL preserve the languages spoken in the audio and SHALL normalize confidently identified Chinese text to Traditional Chinese without blindly converting non-Chinese spans.

#### Scenario: Recording contains Chinese and English
- **WHEN** a recording code-switches between Chinese and English
- **THEN** the display transcript retains the English speech in English
- **AND** confidently identified Chinese text is displayed in Traditional Chinese
- **AND** the system does not translate either span into the other language

#### Scenario: CJK span language is uncertain
- **WHEN** the system cannot confidently distinguish a Chinese span from another CJK language or a proper name
- **THEN** it preserves the original span without destructive conversion
- **AND** it records the uncertainty for review

### Requirement: Taiwanese Hokkien uncertainty remains visible
The system SHALL use Traditional Chinese characters for confidently recognized Taiwanese Hokkien and SHALL preserve uncertain text with review candidates rather than silently replacing it.

#### Scenario: Taiwanese Hokkien phrase is uncertain
- **WHEN** a Taiwanese Hokkien phrase lacks sufficient evidence for one written form
- **THEN** the display transcript retains the unconfirmed text
- **AND** a review flag may include a Traditional-character candidate and a Tai-lo candidate
- **AND** neither candidate is represented as an accepted correction

### Requirement: Recognition context is workflow specific
The system SHALL build transcription context from the explicit workflow template, language hint, output policy, and verified glossary instead of applying one global language-specific vocabulary to every job.

#### Scenario: Sales activity report is transcribed
- **WHEN** a submission is identified as the sales workflow
- **THEN** the transcription request includes the multilingual preservation policy and verified sales terminology
- **AND** the job retains the sales workflow context for summary generation

#### Scenario: General multilingual meeting is transcribed
- **WHEN** a general meeting has no sales workflow context
- **THEN** sales-specific names and terminology are not injected into its transcription prompt

### Requirement: Word correction is separate from punctuation restoration
The system SHALL NOT authorize the punctuation stage to alter, insert, drop, or reorder non-punctuation characters, and SHALL represent proposed word corrections separately.

#### Scenario: Punctuation model changes a word
- **WHEN** punctuation output differs from its input in any non-punctuation or non-whitespace character
- **THEN** the output is rejected under the existing fidelity fallback
- **AND** the raw and display word evidence is not replaced by that output

#### Scenario: Terminology analysis finds a likely homophone
- **WHEN** terminology analysis finds a domain candidate for a suspicious recognized phrase
- **THEN** it records the original phrase, candidate, reason, and timing in a review flag
- **AND** it does not modify immutable raw text

### Requirement: Model selection uses multilingual quality evidence
The system SHALL evaluate candidate transcription configurations on a versioned multilingual corpus before changing the production baseline.

#### Scenario: Candidate model is proposed for production
- **WHEN** an operator proposes a different speech-recognition model or provider configuration
- **THEN** the candidate is measured against the same corpus as the current baseline
- **AND** results include language preservation, Chinese normalization, domain entity, numeric, unsupported-summary, latency, and usage metrics
- **AND** the production baseline is not changed solely because the candidate has a newer or stronger model name
