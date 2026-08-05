## ADDED Requirements

### Requirement: Public summary deep links preserve bearer-link privacy
The public meeting reader SHALL support direct section, topic, and subtopic
navigation without moving the bearer credential into a request path, query
string, or DOM text.

#### Scenario: Recipient follows a nested summary link
- **WHEN** a valid share fragment contains `#<token>::<target-id>`
- **THEN** the browser authenticates with only `<token>`
- **AND** it restores `<target-id>` after the shared summary is rendered
- **AND** keyboard focus moves to the restored target
- **AND** copying the resulting browser URL preserves both access and the deep
  target

#### Scenario: Recipient follows a normal share link
- **WHEN** a valid existing `/share#<token>` URL is opened without a target
- **THEN** it remains compatible
- **AND** selecting a summary navigation link appends only the target inside the
  fragment
- **AND** neither the token nor target is sent in the initial HTTP request or
  ordinary referrer

#### Scenario: Recipient uses skip navigation while the meeting is loading
- **WHEN** a valid share URL is still waiting for its API response
- **THEN** the skip link preserves the active bearer token in the fragment
- **AND** it targets the meeting content without starting an unauthenticated
  read
- **AND** after the response renders, focus moves to that target even when the
  target was selected during the pending request

#### Scenario: Recipient changes to another share before the first load completes
- **WHEN** share A is still loading and the fragment changes to share B
- **AND** share B completes before share A
- **THEN** the reader shows share B
- **AND** the later response from share A cannot replace content or error state

### Requirement: Public transcript omits stored speaker metadata
The public meeting DTO and reader SHALL omit stored speaker classification while
preserving readable transcript text and timing.

#### Scenario: Historical transcript contains speaker metadata
- **WHEN** a shared historical transcript segment contains a speaker field or a
  matching speaker prefix
- **THEN** the DTO omits the speaker field
- **AND** the reader does not render a speaker label
- **AND** a duplicated matching prefix is removed from the visible text
