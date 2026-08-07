## Context

The initial upload investigation used a private 5,616.47-second lossy
derivative. Final hybrid acceptance uses the operator-selected 5,609.52-second
lossless WAV from the same meeting; filenames, fingerprints, job identifiers,
and the share URL are omitted because the repository is public. The existing
Azure result contained 317 segments and 12,576 transcript characters; the
PLAUD share contained 510 segments and seven speaker labels.

PLAUD had higher speech coverage and different terminology on this file, but
neither candidate is a human reference. Its summary
also contained known unsupported claims: it promoted a pending 1-6/1-7
discussion to a decision, described email as a formal channel after the meeting
said not to send email, and asserted a project delay that the meeting did not
announce. A later evidence re-check found `API 2` independently in both the
PLAUD and revised Azure transcripts, so it is supported and is no longer
treated as a PLAUD error.
PLAUD is therefore a comparison candidate, not reference truth.

A later full-audio and original-video validation superseded the specific
assumption that `舌片` was verified ground truth. The shared meeting screen
visibly uses `Tray盤` and `Input Tray Setting`; no human reference transcript
exists to adjudicate every ambiguous spoken occurrence. This does not change
the generic operator-verified alias contract, but the HDD `蛇片 -> 舌片`
example and term counts cannot be used as provider-accuracy evidence.

Targeted Azure tests on the first 20 minutes produced:

| Configuration | Characters |
| --- | ---: |
| Existing stored result | 2,636 |
| One prompted 20-minute request | 2,312 |
| Four prompted five-minute requests, first pass | 3,437 |
| Five-minute requests after replaying one audible 75-character result | 4,452 |
| PLAUD same interval | 5,166 |

The corrected five-minute run improved coverage 68.9% over the stored result
and reached 86.2% of PLAUD's character count. Splitting one five-minute interval
into contextual one-minute calls reduced its output from 1,090 to 834
characters, so smaller default chunks are not justified. A contextual
five-minute prompt improved that interval to 1,239 characters and recognized
`條碼` and `MVS`, but still rendered the disputed tray term as `設備`; prompt
bias alone is not enough for verified terminology.

Those prompted runs measure the optional operator-assisted workflow. Because
their terms came from known errors in the comparison recording, they are not
evidence that any provider can recover previously unknown terminology.

A later full-file run reached 80–85 minutes before that audible five-minute
span returned only 18 characters on both the initial call and its first retry.
Two subsequent identical five-minute replays returned 1,072 and 1,445
characters; contextual 2.5-minute halves returned 780 and 608 characters. This
proves a transient sparse provider result rather than fixed input or format
failure. A second bounded same-span retry is the smallest recovery that keeps
the five-minute coverage advantage and still refuses persistently sparse text.

For summaries, the same current prompt and transcript were tested with Luna,
Terra, and Sol. Sol provided the best qualitative coverage and the highest
heuristic support overlap with raw transcript text (40.4%, versus 39.2% Luna
and 39.1% Terra). All three inherited ASR errors, so summary-model selection
does not replace transcription correction.

## Goals / Non-Goals

**Goals:**
- Recover materially more spoken content from long uploaded meetings.
- Correct operator-verified terminology without destroying provider evidence.
- Measure general ASR quality without feeding reference-derived answers to the
  provider.
- Establish oracle-free evidence for recognition uncertainty without silently
  choosing between conflicting hypotheses.
- Add conservative, cross-chunk anonymous speaker evidence without allowing
  the diarization model to replace primary transcript text.
- Make the observed summary HTTP 400 durable and observable without replaying a
  paid provider request.
- Ingest the actual 318 MiB comparison video through the supported upload path.
- Compare terminology, unsupported-summary claims, coverage, and speaker
  evidence separately without declaring an external candidate ground truth.

**Non-Goals:**
- Claim perfect recognition or treat PLAUD as ground truth.
- Ship an always-on independent ASR verifier before a candidate and ongoing
  latency/cost policy clear the same-audio quality gate.
- Add fuzzy, model-generated, or global automatic word replacement.
- Pass terms learned from the benchmark recording, PLAUD, or a human reference
  into a provider-quality benchmark.
- Add a general retry framework or retry timeouts, HTTP 429, or HTTP 5xx.
- Use `gpt-4o-transcribe-diarize` as the primary text provider, infer real
  speaker names, or claim a human-labelled diarization error rate.
- Commit, push, or archive this change.

## Decisions

### 1. Persist a bounded operator-verified glossary on uploaded jobs

The upload form accepts at most 50 non-empty lines of at most 200 characters
each. A plain line is a correct term, phrase, or short context sentence used
only to bias recognition. A line in this form defines exact accepted aliases:

```text
條碼 = 調碼
MoveIn = moving | move in
GroupID = group ID
```

The control plane trims and deduplicates the lines, persists them as
`transcriptionGlossary`, returns them to the transcription claim, and rejects
invalid input before creating a job. No domain-specific glossary is injected
globally.

### 2. Apply accepted aliases only to derived display text

The worker sends only the canonical left-hand term or phrase to Azure. When
Azure returns an exact configured alias, the normalizer keeps the original
provider text in `rawText`, substitutes the canonical value only in
`displayText`, and emits a review flag naming the original, accepted value,
timing, and operator-verified glossary evidence.

Plain glossary lines and existing built-in sales aliases remain recognition
hints or non-authoritative candidates. There is no fuzzy matching and no
second text-model rewrite of the transcript.

### 3. Use five-minute Azure chunks with bounded continuity

Cloud transcription uses five-minute chunks when the prepared file must be
split. The next chunk receives the preceding accepted transcript's final 800
characters under an explicit "context only" label. The first chunk receives no
fabricated previous context.

An audible five-minute-or-longer chunk with fewer than the existing density
threshold is retried up to twice by the existing sparse-retry path. For a
five-minute chunk each retry is a same-duration retranscode and provider
request; longer chunks are still split into five-minute retry uploads. A third
consecutive sparse audible result fails explicitly rather than being stored as
complete.

The full correct-WAV follow-up also found a separate HTTP 200 content failure:
one Qwen 60-second chunk returned 2,504 characters with gzip ratio 41.966 and
dominant-repeat share 0.943. Two 30-second retries of the same source audio
returned 139 and 155 characters with gzip ratios 1.471 and 1.472. Applying the
same content-agnostic gzip threshold to the stored Azure artifact flags its
first five and final three minutes of long-text loops.

For an audio span of at least 20 seconds, the existing sparse-retry seam
therefore also rejects normalized text whose UTF-8 byte count divided by its
standard-library gzip size exceeds 4.0. The duration floor prevents very short
synthetic or acknowledgement-heavy spans from being classified by compression
alone.
Repetition recovery reuses the same two-attempt lifecycle, usage accounting,
temporary-file cleanup, and original-audio transcode path, but limits retry
uploads to 30 seconds. It retains the base prompt and job glossary while
removing preceding generated transcript context so a rejected hypothesis
cannot bias its own recovery. No terminology list or model-generated rewrite
participates in the gate.

### 4. Preserve summary HTTP 400 without replay

The shared Responses transport exposes the HTTP status and redacted provider
error body through a typed error. The quota-only Azure summary caller records
that one reserved request as failed and does not call `request_response` again.
The request-level audit preserves its status, external request ID when present,
and unpriced possible charge. The later `simplify-mai-transcription-pipeline`
change removes punctuation calls from new jobs, so their historical retry
metadata remains read-compatible but is not an active summary contract.

### 5. Return a bounded upload error

Multer continues writing uploads to a temporary file, so the control plane does
not hold the full body in memory. The default limit becomes 512 MiB. A
`LIMIT_FILE_SIZE` error returns HTTP 413 with
`uploaded-media-too-large`; tests use a smaller injected limit instead of
allocating a 512 MiB fixture.

### 6. Treat "better than PLAUD" as separate evidence gates

Provider quality and assisted product quality are separate gates. An
unassisted provider comparison receives the audio, generic language/output
policy, and preceding same-recording context only. It receives no term,
phrase, or alias learned from the reference transcript, PLAUD output, or
manual listening. Any optional workflow context that existed before
transcription is reported as a separate assisted result.

The assisted HDD workflow benchmark passes only when:

- every configured accepted alias is absent from `displayText`, its canonical
  value is present, and the original remains in `rawText`;
- the new transcription exceeds the existing stored transcript coverage by at
  least 50% without repeated adjacent hallucinated text;
- the Sol summary contains no known unsupported decision/channel/schedule
  claims identified above;
- coverage, terminology, speaker attribution, latency, request count, and
  unpriced usage are reported separately.

No overall superiority claim is made from character count alone. Speaker
attribution remains an explicit quality gap until a diarization candidate
passes the same-audio fidelity and attribution checks.

The completed full-file benchmark is recorded in `benchmark.md`. The revised
run produced 23,461 display characters in 674 segments, 86.6% more than the
stored transcript and 87.3% of PLAUD coverage. Nineteen initial uploads plus
one sparse replay completed in 561.0 seconds. The final Sol summary used one
metered request and kept the pending 1-6/1-7 point out of decisions, omitted
the unsupported formal-email and delay claims. Its operator-configured
`舌片` display term was later invalidated as an accuracy score by
original-video `Tray盤` evidence. Speaker and transcript coverage remain
separate comparison dimensions.

### 7. Use multiple hypotheses as evidence, not automatic truth

An oracle-free 780–840 second probe showed why neither phrase lists nor one
confidence threshold are a general solution:

- Azure OpenAI returned 234 token log probabilities but rendered the disputed
  phrase as `上傳是可以用的`; the whole wrong phrase was not low confidence.
- A second Azure OpenAI call at temperature 0.8 rendered it as
  `上傳設備用的`.
- Standard Azure Speech without a phrase list rendered it as
  `上船10片用的`.
- PLAUD rendered it as `上傳舌片用的`, but remains comparison evidence rather
  than ground truth.

The existing worker `transcribe(...) -> artifact` seam remains the external
interface. A future generic quality implementation belongs behind that interface:
collect an unassisted primary hypothesis with token confidence, collect an
independent unassisted verifier hypothesis, and attach disagreement evidence
to the affected transcript span. Confidence can prioritize review, but cannot
authorize a correction by itself. The primary `rawText` remains immutable.

Automatic display correction requires independent trusted evidence that
existed before recognition, such as an uploaded agenda, a project vocabulary,
or a previously operator-accepted term. Without that evidence or agreement
between independent hypotheses, the system records candidates for review and
does not silently choose a homophone. Running a verifier for every chunk has
ongoing latency and provider-cost impact. No tested candidate cleared the
terminology/fidelity gate, so this change records the evidence and defers the
verifier implementation and its normative contract to a later OpenSpec change.

### 8. Use diarization only as optional speaker evidence

> **Superseded runtime decision:** `simplify-mai-transcription-pipeline` later
> removed diarization configuration and requests from the canonical
> transcription worker, and `refine-meeting-artifact-reader` removed speaker
> classification from normal readers. The remainder of this section records the
> earlier experiment and implementation rationale only; it is not the current
> runtime or presentation contract. Historical artifacts remain compatible.

The supplied `gpt-4o-transcribe-diarize` Azure deployment succeeded through
the deployment-specific audio transcription route on the oracle-free 780–840
second interval. A lossy AAC upload returned ten timed segments with two
generic speaker labels in 20.0 seconds, but turned the first 13.8 seconds into
unsupported English. Adding `language=zh` did not fix that failure. Sending
the same interval as 16 kHz mono PCM removed the English hallucination and
returned three labels, but still merged and split speakers within the short
window.

A five-minute 600–900 second PCM follow-up provided enough context for a more
useful speaker comparison. It returned 42 timed segments and three labels in
93.5 seconds. After the best one-to-one label mapping, it agreed with PLAUD on
97.2% of 215.4 seconds where both candidates supplied a label and covered
84.9% of PLAUD-labelled speech. PLAUD has a fourth label for one brief speaker,
so this is comparison evidence rather than a ground-truth diarization error
rate.

The text gate still failed. The diarized result had 1,087 normalized lexical
characters and 89.1% of PLAUD's overlapping character coverage, but its
normalized sequence similarity to PLAUD was 0.614, below the production
baseline's 0.718. It omitted both `舌片` and `條碼`, alternated between `MVS`
and `MBS`, and contained visibly unsupported or garbled spans. The production
baseline required one sparse replay, then returned the more faithful primary
text in 13.0 seconds.

The deployment is therefore a viable speaker-evidence candidate, not a primary
text provider. The user approved the added latency/provider use on 2026-07-28
for an opt-in implementation and same-audio verification. The existing worker
`transcribe(...) -> artifact` seam remains unchanged for callers.

When all diarization credentials are configured, the worker starts a parallel
speaker-evidence pass over at-most-five-minute 16 kHz mono PCM chunks. The
first successful chunk supplies up to four automatically extracted 2–8 second
anonymous speaker references to later chunks. A live 900–1200 second follow-up
used three references extracted from the preceding 600–900 second result. The
Azure deployment returned the same three reference names in 97.7 seconds; the
fixed earlier mapping remained the best PLAUD-relative mapping and agreed on
93.8% of 220.2 seconds where both candidates supplied labels. This validates
cross-chunk anonymous continuity, not a real-name identity or ground-truth
error rate.

The primary result remains the sole source for `rawText`, `displayText`, and
the transcript wording used by summary input. For each matching five-minute
chunk, a standard-library
sequence alignment compares normalized primary text with diarized candidate
text. A primary segment receives `speaker`, `speakerSource`, and a derived
alignment score only when at least four characters match, at least 35% of its
normalized text is covered, one speaker owns at least 75% of matched
characters, and the segment is no longer than 60 seconds. Otherwise the
speaker remains absent. Diarized candidate text is never stored as transcript
text and never authorizes terminology correction. An aligned anonymous label
may prefix that unchanged primary wording in the summary prompt; the prompt
forbids inferring a real identity from the label.

The first chunk's selected labels become stable anonymous labels such as
`Speaker A`. A later generic label that does not match a known reference is
namespaced to its chunk so it cannot impersonate a stable speaker. At most
four speakers can be stabilized by the provider reference interface; remaining
speakers stay chunk-scoped until an independently supplied reference exists.
When a speaker has no single two-second utterance, adjacent same-label speech
clips may be concatenated as one valid 2–8 second PCM reference.

The first speaker chunk bootstraps references. When it yields fewer than four,
the second chunk runs before the parallel batch and may add previously unseen
anonymous speakers up to the provider's four-reference limit. Remaining
chunks use bounded parallelism so the full-file wait approaches the slower of
primary transcription and diarization rather than their sum.

The worker retries transient diarization failures with the identical body:
`404 DeploymentNotFound` and HTTP 400 once after two seconds, and DNS, timeout,
reset, or broken connection after 2, 10, and 30 seconds. A still-failed
`DeploymentNotFound` chunk is requeued once after the parallel batch and a
bounded 15-second delay. This delayed repair is required by the correct-WAV
full run, where one chunk received three consecutive 404 responses while
adjacent and later chunks succeeded unchanged. A final diarization failure
never overwrites or fails a valid primary transcript: affected labels remain
absent, failure/request counts stay observable, and all diarization audio usage
is settled separately as unpriced transcription-stage usage.
A provider-accepted HTTP 200 request remains counted as processed audio even
when its response body cannot be parsed; response validation failure does not
reclassify that spent request as unmetered.

If primary transcription fails or the operator cancels, a cooperative stop
prevents diarization chunks that have not started and the delayed repair from
issuing more provider calls. Requests already in flight finish so their usage
can still be reported on the failure event.

### 9. Generate one fluent hierarchical summary and derive compatibility fields

The production summary remains one `gpt-5.6-luna` request with
`reasoning.effort=max`. There is no separate full-transcript polishing request
and no second summary rewrite. The prompt asks the model to convert fragmented
spoken language into concise, grammatically complete Traditional Chinese while
preserving the supported meaning, uncertainty, names, numbers, and chronology.

The canonical model output contains a title, overview, content-derived topics,
subtopics, topic conclusion/status, grouped follow-ups, decisions, risks, open
questions, and evidence-backed analysis notes. It contains no target topic
count. A main topic exists only for an independent decision domain, process,
deliverable, or scope boundary; related functions, screens, exceptions, and
examples stay under subtopics. Items with the same deliverable or root cause
are grouped so completeness does not become repetition.

Only an explicit request, assignment, commitment, test, confirmation, reply,
or delivery becomes follow-up work. A requirement or design conclusion alone
does not. When a technical identifier is internally inconsistent or cannot be
confirmed from the transcript, the summary uses the supported functional
description rather than selecting one ASR hypothesis.

The worker derives the existing `points`, `keyPoints`, and `actionItems` fields
from the canonical hierarchy before storage. Historical artifacts keep their
existing flat representation, and current readers prefer the hierarchy while
falling back to the legacy fields. The 93-minute Luna/max validation completed
in 265.5 seconds, close to the prior 300-second socket limit, so the summary
request timeout becomes 900 seconds without adding a timeout retry.

## Risks / Trade-offs

- Five-minute chunks increase provider request count and latency. A sparse or
  repetitive span can process the same audio up to three times, and repetition
  recovery uses more 30-second requests, but bounded recovery prevents invalid
  text from being stored.
- Previous text can propagate an earlier error, so its tail is bounded and
  labelled as context rather than instruction.
- Exact alias replacement can still be wrong if an operator supplies a bad
  mapping, so it is job-specific, visible, and never overwrites raw evidence.
- An Azure summary HTTP 400 remains one visible, unpriced provider request and
  is not replayed.
- 512 MiB uploads consume more temporary disk, but remain file-backed and
  bounded by one explicit limit.
- An independent verifier can detect high-confidence primary errors that
  log-probability thresholds miss, but it increases provider requests and does
  not guarantee that either hypothesis is correct.
- Diarization can add speaker metadata while reducing transcript fidelity or
  misassigning speakers, so successful API access is not a provider-selection
  gate.
- Automatically bootstrapped references can propagate a first-chunk speaker
  mistake and can stabilize at most four speakers. Labels therefore remain
  anonymous, alignment-gated, and chunk-scoped when they do not match a known
  reference.
- Bounded parallel diarization shortens wall time but can encounter deployment
  rate limits; the worker keeps a small configurable concurrency ceiling and
  preserves the primary transcript when speaker evidence fails.
- A richer hierarchy can become verbose; semantic grouping rules constrain
  repetition without a guessed topic-count limit.
- A 900-second summary socket timeout can hold a worker lease longer during a
  provider stall; the existing heartbeat, operator stop, and single-request
  policy bound the operational impact without issuing duplicate paid work.

## Migration Plan

1. Add the nullable/default-empty recording-job glossary column and deploy
   control-plane readers before relying on worker claims.
2. Deploy compatible control-plane and transcription/summary workers together.
3. Keep existing jobs without a glossary compatible as an empty list.
4. Run the redacted HDD benchmark before changing any production model policy.
5. Keep the optional diarization implementation dormant in the canonical
   Compose workflow by not supplying its endpoint, deployment, API-version, or
   key to the transcription worker.
6. Preserve existing raw/display transcript artifacts and optional speaker
   fields for compatibility, but ignore speaker metadata in summaries,
   operator/admin readers, and text exports.
7. Roll back the earlier glossary/chunk changes by omitting new glossary input
   and restoring the old worker chunk constant; stored raw/display artifacts
   and the additive column remain readable.
