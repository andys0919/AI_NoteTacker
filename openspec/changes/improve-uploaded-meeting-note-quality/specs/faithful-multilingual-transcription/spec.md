## ADDED Requirements

### Requirement: Uploaded jobs carry bounded verified recognition context
The system SHALL let an upload operator attach a bounded job-specific list of verified terms, phrases, and exact aliases, SHALL retain that context with the job, and SHALL NOT inject it into unrelated jobs.

#### Scenario: Operator submits verified terms with an upload
- **WHEN** an operator uploads supported media with valid verified glossary lines
- **THEN** the job persists the normalized deduplicated lines
- **AND** the transcription claim exposes the same lines to the selected worker
- **AND** Azure transcription receives the canonical terms or phrases as recognition context

#### Scenario: Operator submits an invalid glossary
- **WHEN** the glossary exceeds its term-count or per-line length limit
- **THEN** the control plane rejects the upload request before creating a job
- **AND** it removes any temporary upload file

#### Scenario: Unrelated job has no glossary
- **WHEN** another job is submitted without verified recognition context
- **THEN** it does not inherit terms or aliases from an earlier job

### Requirement: Verified aliases correct only derived transcript text
The system SHALL apply an operator-accepted exact alias only to derived display text while preserving the provider text and correction evidence.

#### Scenario: Provider returns an accepted exact alias
- **WHEN** provider text contains an exact alias configured for that job
- **THEN** `rawText` retains the provider alias
- **AND** `displayText` contains the configured canonical value
- **AND** the segment records the original alias, accepted value, timing, and operator-verified evidence

#### Scenario: Provider text has no exact accepted alias
- **WHEN** provider text does not contain an exact alias configured for that job
- **THEN** the terminology step does not fuzzily rewrite the text
- **AND** no model-generated correction silently replaces provider evidence

### Requirement: Provider-quality benchmarks are oracle free
The system SHALL evaluate general provider recognition without supplying terms, phrases, or aliases learned from the benchmark recording, a comparison provider, or a human reference transcript.

#### Scenario: Candidate provider is compared on recorded audio
- **WHEN** a transcription provider or model is evaluated for general recognition quality
- **THEN** its unassisted result receives no vocabulary derived from that recording's expected answer
- **AND** generic language/output policy and preceding same-recording context may remain enabled
- **AND** any operator-assisted result is reported separately

#### Scenario: Trusted context existed before transcription
- **WHEN** an agenda, project vocabulary, or previously accepted term existed independently before the benchmark recording was transcribed
- **THEN** the system may measure it as an assisted workflow
- **AND** the result identifies the context source instead of presenting it as unassisted model quality

### Requirement: Long Azure transcription preserves bounded continuity and retries invalid content
The system SHALL split long Azure transcription work into at most five-minute audio chunks, provide bounded preceding transcript context to later chunks, and retry one audible sparse or highly repetitive chunk up to twice before failing.

#### Scenario: Long recording requires multiple provider uploads
- **WHEN** prepared audio exceeds the single-request boundary
- **THEN** every initial Azure upload covers at most five minutes
- **AND** each chunk after the first receives at most the configured preceding transcript tail as context
- **AND** the first chunk receives no fabricated preceding transcript

#### Scenario: Audible five-minute chunk returns suspiciously sparse text
- **WHEN** a five-minute-or-longer chunk has audible activity but returns text below the configured density threshold
- **THEN** the worker retries that audio span at most twice with the same workflow context
- **AND** the first non-sparse retry replaces the sparse result
- **AND** a third consecutive sparse result fails transcription explicitly

#### Scenario: Successful provider response contains highly repetitive text
- **WHEN** Azure returns HTTP 200 for an audio span of at least 20 seconds but the normalized transcript exceeds the configured gzip compression-ratio threshold
- **THEN** the worker rejects that text as a content failure
- **AND** it retries the same original audio span at most twice using chunks no longer than 30 seconds
- **AND** repetition retries retain generic policy and job-specific glossary context but omit preceding generated transcript context
- **AND** the first retry result that passes both sparse and repetition gates replaces the rejected result
- **AND** a third consecutive invalid result fails transcription explicitly

### Requirement: Historical diarization evidence remains compatible without new requests
The earlier optional diarization runtime in this change is superseded by
`simplify-mai-transcription-pipeline`, and its speaker presentation is
superseded by `refine-meeting-artifact-reader`. The system SHALL preserve
historical diarization metadata as evidence while the canonical transcription
worker issues no new diarization request.

#### Scenario: A new canonical transcription job runs
- **WHEN** the transcription worker processes a newly claimed job
- **THEN** it does not receive or invoke diarization configuration
- **AND** primary transcript text remains the only transcript-text authority
- **AND** it does not add new speaker classification

#### Scenario: A historical artifact contains diarization metadata
- **WHEN** an existing transcript contains a speaker label, source, or alignment score
- **THEN** the stored artifact remains schema-compatible and unchanged
- **AND** the summary prompt and normal user-facing text views ignore that metadata
