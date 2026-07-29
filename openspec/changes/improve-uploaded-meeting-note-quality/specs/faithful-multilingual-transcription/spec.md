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

### Requirement: Diarization adds speaker evidence without changing primary text
The system SHALL optionally combine primary transcription text with independently produced diarization speaker evidence while preserving the primary provider as the only transcript-text authority.

#### Scenario: Configured diarization aligns with primary text
- **WHEN** separate diarization credentials are configured and a diarized speaker span passes the deterministic alignment gate for a primary transcript segment
- **THEN** the segment retains its original primary `rawText`, `displayText`, and `text`
- **AND** it records an anonymous speaker label, the diarization source, and the derived alignment score
- **AND** no diarized candidate text replaces transcript or summary wording
- **AND** the aligned anonymous label may prefix that unchanged wording for summary attribution without implying a real identity

#### Scenario: Speaker alignment is insufficient
- **WHEN** diarized candidate text does not meet the configured minimum matched-character, coverage, dominance, or segment-duration gate
- **THEN** the primary transcript segment remains unchanged
- **AND** the system omits its speaker instead of guessing

#### Scenario: Anonymous speaker references continue across chunks
- **WHEN** either of the first two diarization chunks contains suitable same-label speech totaling at least two seconds
- **THEN** the worker bootstraps and passes at most four anonymous audio references to later diarization chunks
- **AND** it may concatenate same-label PCM clips into one valid 2–8 second reference
- **AND** matching later spans retain those anonymous labels
- **AND** a later unmatched generic label is chunk-scoped rather than impersonating a stable speaker

#### Scenario: Diarization returns transient DeploymentNotFound
- **WHEN** the configured diarization deployment returns HTTP 404 with `DeploymentNotFound`
- **THEN** the worker retries the identical request once with bounded backoff
- **AND** a still-failed chunk is requeued once after the parallel batch
- **AND** another failure does not requeue that chunk again
- **AND** a valid primary transcript still completes without unsupported speaker labels

#### Scenario: Diarization returns a transient HTTP 400
- **WHEN** the configured diarization deployment returns HTTP 400
- **THEN** the worker retries the identical request once after two seconds
- **AND** another HTTP 400 fails only that speaker-evidence chunk
- **AND** a valid primary transcript still completes unchanged

#### Scenario: Diarization has a transient transport failure
- **WHEN** a diarization request fails because of DNS, timeout, reset, or broken connection
- **THEN** the worker retries the identical request after 2, 10, and 30 seconds
- **AND** failure after the third retry fails only that speaker-evidence chunk
- **AND** cancellation during backoff prevents the next provider request
- **AND** a valid primary transcript still completes unchanged

#### Scenario: Diarization usage is reported
- **WHEN** the optional diarization pass issues provider requests
- **THEN** its model, processed audio, request count, unmetered request count, and failed chunk count are reported separately from primary transcription
- **AND** an HTTP 200 response with an invalid body still records its accepted audio and request as spent
- **AND** the control plane stores that second-model usage as an unpriced transcription-stage ledger entry

#### Scenario: Primary transcription fails after diarization spends requests
- **WHEN** the optional diarization pass issues provider requests and primary transcription later fails or is cancelled
- **THEN** queued diarization chunks and delayed repair stop before issuing additional provider requests
- **AND** requests already in flight may finish
- **AND** the transcription failure event still reports the spent diarization usage
- **AND** the control plane stores it as the same separate unpriced transcription-stage ledger entry
