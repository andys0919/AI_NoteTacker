## ADDED Requirements
### Requirement: Transcript punctuation uses a strict Azure Responses contract
The system SHALL restore punctuation through an explicitly configured Azure
Responses endpoint and key using the configured punctuation model, and SHALL
disable Responses application-state/message-history storage for every
punctuation request.

#### Scenario: Raw transcript chunk is sent for punctuation
- **WHEN** the Azure transcriber produces an unpunctuated transcript chunk and punctuation restoration is enabled
- **THEN** the worker sends the configured model, punctuation instructions, raw chunk, and `store: false` to the explicit Responses endpoint
- **AND** the request uses the explicit Responses API key
- **AND** the request is attributed to the independent `punctuation` cloud stage

#### Scenario: Completed punctuation response contains output text
- **WHEN** the Responses API returns `status=completed` with one or more assistant `output_text` parts
- **THEN** the worker reads every string-valued `output_text` part in response order
- **AND** it concatenates the exact fragments without inserting characters, trims only the final aggregate, and ignores `reasoning` and all other item types

### Requirement: Transcript punctuation remains fidelity guarded and best effort
The system SHALL replace a raw transcript chunk only when the completed
Responses output changes punctuation or whitespace and SHALL otherwise preserve
the raw chunk without failing transcription.

#### Scenario: Model changes only punctuation and whitespace
- **WHEN** the completed Responses output has the same non-punctuation characters as the raw chunk
- **THEN** the restored text replaces that raw chunk

#### Scenario: Model changes a word
- **WHEN** the Responses output adds, drops, changes, or reorders any non-punctuation character
- **THEN** the restorer keeps the raw chunk unchanged
- **AND** transcription continues

#### Scenario: Punctuation response fails validation
- **WHEN** the request fails, times out, returns a status other than `completed`, or has no valid assistant output
- **THEN** the restorer keeps the raw chunk unchanged
- **AND** the caller does not issue a hidden Responses provider retry
- **AND** the punctuation attempt still reaches a terminal usage-settlement outcome
