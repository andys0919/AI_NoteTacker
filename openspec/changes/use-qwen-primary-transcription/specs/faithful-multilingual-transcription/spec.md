## ADDED Requirements

### Requirement: Qwen output preserves evidence and rejects invalid content

The system SHALL remove Qwen transport protocol markers before transcript
normalization, preserve the remaining provider wording as immutable raw
evidence, and apply the existing content-quality gate to every Qwen chunk.

#### Scenario: Qwen returns language and ASR markers

- **WHEN** a successful Qwen response contains one or more
  `language ...<asr_text>` markers
- **THEN** every marker is removed from transcript wording
- **AND** the detected provider language drives deterministic display
  normalization
- **AND** the remaining Qwen wording is stored as `rawText`

#### Scenario: Qwen processes an ordinary job

- **WHEN** the worker submits a prepared audio chunk to Qwen
- **THEN** the recognition request contains no phrase list, job glossary,
  expected answer, or previous-model transcript prompt
- **AND** any operator-verified glossary is limited to traceable post-ASR
  display evidence without modifying Qwen `rawText`

#### Scenario: Qwen returns repetitive HTTP-200 content

- **WHEN** a Qwen response for at least 20 seconds exceeds the configured
  repetition threshold
- **THEN** the worker rejects the content despite HTTP success
- **AND** it retries the original audio under the existing bounded 30-second
  retry policy
- **AND** persistently invalid content fails explicitly instead of being stored

### Requirement: Historical provider comparison is blind and evidence based

The system SHALL compare Qwen with stored Azure transcripts on multiple
historical recordings without using comparison transcripts as recognition
input.

#### Scenario: Stored Azure job is reprocessed for comparison

- **WHEN** the original stored audio is submitted to Qwen for evaluation
- **THEN** Qwen receives no Azure text, external transcript, or
  recording-derived expected vocabulary
- **AND** the comparison separately reports source duration, output length,
  agreement, repetition, detected language, latency, and material sampled
  differences
- **AND** it does not claim either provider is accurate without independent
  human reference evidence
