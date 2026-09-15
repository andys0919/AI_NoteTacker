## ADDED Requirements

### Requirement: Public transcript exposes resolved speaker labels

The public meeting DTO and reader SHALL expose only a resolved speaker display
label and readable transcript timing/text. They MUST omit stored speaker maps,
provider evidence, raw recognition fields, and internal transcript metadata.

#### Scenario: Public transcript contains speaker metadata

- **WHEN** a valid bearer share is opened for a transcript with speaker labels
- **THEN** the public DTO includes the resolved display label for each readable
  segment
- **AND** the reader shows the same speaker turn structure as the owner reader
- **AND** the DTO omits speaker maps, raw text, review flags, and provider
  evidence

### Requirement: Public result reader uses the canonical artifact template

The public bearer result SHALL render the existing artifact reader used by the
owner and admin result pages.

#### Scenario: Recipient opens a completed shared result

- **WHEN** a valid active share URL is opened
- **THEN** the page uses the same summary/transcript tabs, hierarchy, spacing,
  and responsive reader layout as the owner result page
- **AND** owner-only mutation controls are absent

### Requirement: Public result reader provides authenticated read-only actions

The public bearer result SHALL provide recording playback and Markdown
download through authenticated read-only routes.

#### Scenario: Recipient plays the shared recording

- **WHEN** a recipient activates playback on a valid active share
- **THEN** the recording route accepts the bearer credential in the
  Authorization header
- **AND** playback succeeds without placing the bearer credential in a path,
  query string, referrer, or DOM text

#### Scenario: Recipient downloads the shared Markdown

- **WHEN** a recipient activates a Markdown download on a valid active share
- **THEN** the export route returns the public allowlisted meeting content with
  timestamps and resolved speaker labels
- **AND** it omits owner identity, internal metadata, raw evidence, and mutation
  controls
