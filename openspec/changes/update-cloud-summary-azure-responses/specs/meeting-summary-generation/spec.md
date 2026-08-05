## ADDED Requirements
### Requirement: Cloud summaries use a strict Azure Responses contract
The system SHALL generate Azure OpenAI meeting summaries through an explicitly
configured Responses API endpoint and key, SHALL disable Responses
application-state/message-history storage, and SHALL accept only a completed
response with valid assistant output and usage metadata.

#### Scenario: Summary request disables Responses application-state storage
- **WHEN** a summary-enabled job is summarized by the Azure OpenAI provider
- **THEN** the worker sends the configured model, summary instructions, transcript input, and `store: false` to the explicit Responses endpoint
- **AND** it authenticates with the explicitly configured Responses API key
- **AND** it does not derive or reuse a legacy `chat/completions` endpoint

#### Scenario: Completed response contains multiple output text parts
- **WHEN** the Responses API returns `status=completed` with multiple `message` items or `output_text` content parts
- **THEN** the worker reads every string-valued `output_text` part in response order
- **AND** it concatenates the exact fragments without inserting characters, trims only the final aggregate, and ignores `reasoning` and all other item types
- **AND** it stores a structured summary artifact recording the configured model

#### Scenario: Response is incomplete or has no assistant output
- **WHEN** the Responses API status is not `completed` or no non-empty assistant `output_text` can be extracted
- **THEN** summary generation records an explicit summary-stage failure
- **AND** it does not store a partial or empty summary artifact

#### Scenario: Summary request exceeds its socket-operation timeout
- **WHEN** a blocking Responses connection or socket operation exceeds the configured timeout
- **THEN** the provider call fails explicitly as a timeout
- **AND** the caller does not issue a hidden provider retry
- **AND** it does not store a summary artifact from that attempt

### Requirement: Cloud summary usage is strict and honestly priced
The system SHALL require valid provider-reported usage before accepting a cloud
summary as completed and SHALL preserve unpriced usage without fabricating an
actual USD cost.

#### Scenario: Completed summary returns valid usage
- **WHEN** a completed Responses summary includes non-negative integer `input_tokens`, `output_tokens`, `total_tokens`, `input_tokens_details.cached_tokens`, and `output_tokens_details.reasoning_tokens`
- **THEN** the summary stage records those values as input, output, and total tokens
- **AND** it preserves cached-input and reasoning token details
- **AND** it does not substitute missing values with zero

#### Scenario: Completed response has missing or malformed usage
- **WHEN** an otherwise completed summary response omits required usage or returns malformed token values
- **THEN** the summary attempt fails before artifact completion
- **AND** it does not synthesize a zero-token or zero-cost successful result

#### Scenario: Valid usage accompanies an invalid summary result
- **WHEN** a Responses call returns complete valid usage but its status, assistant output, or structured summary validation fails
- **THEN** the summary attempt fails before artifact completion
- **AND** the terminal failure callback preserves the valid provider-reported usage for settlement
- **AND** it does not store a partial summary artifact

#### Scenario: Summary JSON is missing its required schema
- **WHEN** assistant output parses as JSON but does not contain a non-empty string `summary`, a valid `topics` array, and string-array `key_points`, `action_items`, `decisions`, `risks`, and `open_questions`
- **THEN** the summary attempt fails validation
- **AND** an empty object or mistyped field is not rendered as a successful all-empty summary
- **AND** any otherwise valid provider usage remains available to the failure callback

#### Scenario: Official model price is unavailable
- **WHEN** a valid cloud summary uses `gpt-5.6-luna` and no official price for that model is configured
- **THEN** its usage record stores `costUsd: null` and `pricingStatus: unpriced`
- **AND** no other model's price or estimated fallback is used
- **AND** reports do not describe the record as actual USD cost
