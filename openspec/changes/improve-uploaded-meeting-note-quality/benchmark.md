# HDD workflow benchmark

## Scope

- Canonical acceptance source: the private lossless WAV selected by the
  operator; filename, fingerprint, job identifier, and share URL are omitted
  because this repository is public
- Canonical duration: 5,609.52 seconds
- Compared artifacts: existing stored Azure transcript, the revised local
  Azure/Sol pipeline, and the existing PLAUD share.

Character count is a coverage proxy, not word-error-rate proof. PLAUD latency,
provider request count, and billing metadata are unavailable from the share.
Earlier sections below retain measurements made from a 5,616.47-second lossy
derivative for historical design evidence. They are not the final hybrid
acceptance result. The final correct-WAV result is reported separately below
and received no recording-derived phrase list or alias.

## 2026-07-29 evidence correction

The later full-audio and original-video validation supersedes every use of
`舌片` counts below as an accuracy score. Frames from the meeting itself
visibly contain `Tray盤`, `Input Tray Setting`, `MVS`, `MoveIn`, `MES3`,
`GroupID`, and `HDD`. The source folder has no human reference transcript, so
the video proves the official meeting vocabulary but does not prove that every
ambiguous spoken occurrence must be `Tray盤`.

The earlier `蛇片 -> 舌片` display rewrite was an operator-configured assisted
alias, not independent ground truth. It remains useful evidence that the
generic raw/display alias contract preserves provider text, but it must not be
used to claim terminology accuracy for this recording. See
`docs/research/2026-07-29-full-asr-validation.md` for the full 5,609.52-second
Qwen, production faster-whisper, Azure artifact, video-context, and
evidence-constrained correction results.

## Historical assisted derivative result

| Dimension | Existing local | Revised local | PLAUD |
| --- | ---: | ---: | ---: |
| Transcript segments | 317 | 674 | 510 |
| Transcript characters | 12,576 | 23,461 display / 22,923 raw | 26,865 |
| Coverage versus existing | baseline | +86.6% | +113.6% |
| Coverage versus PLAUD | 46.8% | 87.3% | baseline |
| Speaker attribution | none | none | 7 labels |
| Transcription elapsed | unavailable | 561.0 seconds | unavailable |
| Transcription provider requests | unavailable | 20 | unavailable |

The revised run made 19 initial five-minute-or-shorter uploads and one sparse
replay. It completed the previously failing 80–85 minute span instead of
storing an 18-character response. Punctuation made 69 provider requests; the
fidelity guard rejected 52 rewrites, one request was unmetered, and every
rejected rewrite kept the transcript text unchanged.

The final Sol summary completed in 42.2 seconds with one metered request:
20,515 input tokens, 3,050 output tokens, and 1,507 reasoning tokens within the
output count.

## Oracle-assisted Azure Speech `eastus2` capability control

The configured `eastus2` Azure Speech resource was tested on the same 600–900
second MP3 and the same four canonical terms. Standard fast transcription
succeeded, proving the key, resource endpoint, multipart request, and audio are
valid.

Punctuation and whitespace differ between providers, so the normalized count
below retains only Unicode letters and numbers.

| Same 600–900 second interval | Standard Azure Speech | Revised Azure OpenAI | PLAUD |
| --- | ---: | ---: | ---: |
| HTTP/result | 200 | existing successful candidate | existing share |
| Elapsed | 12.1 seconds | unavailable for isolated span | unavailable |
| Provider segments | 17 | 1 | 25 |
| Display characters | 1,224 | 1,088 | 1,403 |
| Normalized lexical characters | 1,105 | 1,087 | 1,220 |
| Normalized coverage versus PLAUD | 90.6% | 89.1% | baseline |
| Exact `舌片` / `條碼` / case-insensitive `MVS` | 1 / 1 / 2 | 0 / 1 / 7 | 1 / 1 / 0 |
| Exact `英業達` | 0 | 0 | 2 |
| Speaker labels | 0 | 0 | 4 |

Standard Azure Speech emitted `舌片` and `條碼`, but still misheard
`英業達` and other surrounding phrases. Its normalized coverage was only 1.5
percentage points above the revised Azure OpenAI result, and PLAUD still led
on coverage and speaker attribution. This is a useful control result, but not
sufficient evidence to change the production provider. Because the four terms
came from known errors, this table must not be used as a general ASR
model-quality result.

## Oracle-free uncertainty probe

The same 780–840 second audio was then tested without any term or alias from
the recording, PLAUD, or manual listening.

| Candidate | Elapsed | Display characters | Confidence evidence | Disputed phrase | System acronym |
| --- | ---: | ---: | --- | --- | --- |
| Azure OpenAI default | 4.1 seconds | 304 | 234 token log probabilities | `上傳是可以用的` | `MBS` |
| Azure OpenAI temperature 0.8 | 4.2 seconds | 298 | none requested | `上傳設備用的` | `MDS` |
| Standard Azure Speech | 5.6 seconds | 305 | provider phrases | `上船10片用的` | `MVS` |
| Azure OpenAI diarize | 20.0 seconds | 444, including 183 characters of unsupported English | 10 timed segments, 2 speaker labels | omitted; first 13.8 seconds became English | `MVS` |
| PLAUD overlapping segments | unavailable | not compared because segment boundaries extend beyond the minute | none exposed | `上傳舌片用的` | `MBS` |

No unassisted candidate pair agreed on the disputed term. The default Azure
OpenAI response did not mark the entire wrong phrase as low confidence, while
the diarized candidate omitted that span and hallucinated three English
segments. This proves that a fixed confidence threshold, repeated sampling,
or another ASR cannot safely choose the correct homophone by itself. A generic
workflow must retain multiple hypotheses and require independent trusted
context or operator acceptance before changing display text.

The diarized result used two generic labels where the overlapping PLAUD
segments contain three labels, collapsed distinct speakers, and changed labels
within one continuous Joseph utterance. Its seven later segments contain 243
characters, below the production baseline's 304 characters for the full
minute. It is available but does not clear either the transcription-fidelity
or speaker-attribution gate.

## Lossless five-minute diarization follow-up

The initial one-minute diarization failure depended materially on the uploaded
audio representation. Adding `language=zh` to the lossy AAC request did not
remove the first 13.75 seconds of unsupported English and changed `MVS` to
`NVX`. Sending the same minute as 16 kHz mono PCM removed the English
hallucination and returned three labels, although speaker identity was still
unstable in that short window.

The same 600–900 second PCM audio was then sent to the production baseline and
the diarization deployment without a phrase list or reference-derived terms.
The baseline received only the generic preserve-language prompt. Its initial
40-character result triggered the existing sparse-result rule; the first
identical replay returned the candidate reported below.

| Same five-minute PCM interval | `gpt-4o-transcribe` | `gpt-4o-transcribe-diarize` | PLAUD overlapping segments |
| --- | ---: | ---: | ---: |
| Successful-result elapsed | 13.0 seconds | 93.5 seconds | unavailable |
| Provider requests | 2, including one sparse replay | 1 | unavailable |
| Text characters | 1,028 | 1,227 | 1,427 |
| Normalized lexical characters | 1,019 | 1,087 | 1,220 |
| Lexical coverage versus PLAUD | 83.5% | 89.1% | baseline |
| Normalized sequence similarity to PLAUD | 0.718 | 0.614 | 1.000 |
| Exact `舌片` / `條碼` | 0 / 1 | 0 / 0 | 1 / 1 |
| Exact case-insensitive `MVS` / `MBS` | 7 / 0 | 4 / 2 | 0 / 6 |
| Timed segments / speaker labels | 0 / 0 | 42 / 3 | 25 / 4 |

Character coverage alone overstates the diarized text quality: it included
unsupported or garbled spans, omitted both tested Chinese terms, and was less
similar to PLAUD than the primary text. The primary result remained the better
text authority despite its lower character count.

For speaker comparison only, the best one-to-one mapping was `A` to PLAUD
Speaker 4, `B` to Speaker 1, and `C` to Joseph. It agreed on 97.2% of the 215.4
seconds where both candidates supplied labels and covered 84.9% of
PLAUD-labelled speech. PLAUD also contains a brief fourth speaker. These
figures are not a diarization error rate because PLAUD is not ground truth,
but they justify testing the deployment as speaker evidence while rejecting
its text as a replacement.

## Known-speaker continuity follow-up

Three 2–10 second anonymous speaker references were automatically extracted
from the 600–900 second diarization result and supplied to a separate
900–1200 second PCM request. No phrase list, expected term, PLAUD text, or
human transcript was supplied.

| 900–1200 second continuity probe | Result |
| --- | ---: |
| HTTP/result | 200 |
| Elapsed | 97.7 seconds |
| Timed segments | 51 |
| Returned reference labels | 3 of 3 |
| Fixed prior mapping agreement versus PLAUD | 93.8% |
| Compared overlap where both supplied labels | 220.2 seconds |

The best mapping for the later chunk was identical to the fixed mapping from
the earlier chunk: the reference derived from A remained PLAUD Speaker 4, B
remained Speaker 1, and C remained Joseph. This supports using provider audio
references for cross-chunk anonymous continuity. It does not establish real
speaker names or a ground-truth diarization error rate.

## Historical operator-assisted alias result

| Term | Raw evidence | Display result |
| --- | ---: | ---: |
| Historical `蛇片` accepted as `舌片` | 5 `蛇片`, 33 `舌片` | 0 `蛇片`, 38 `舌片` |
| `調碼` accepted as `條碼` | 0 `調碼`, 35 `條碼` | 0 `調碼`, 35 `條碼` |
| `Movie in` accepted as `move in` | 0 `Movie in`, 4 `move in` | unchanged |
| `MVS` | 5 | 5 |

The five `蛇片` occurrences remain in immutable `rawText`; four affected
segments carry `operator-verified-alias` evidence because one segment contains
two occurrences. The later original-video evidence invalidates treating the
configured `舌片` canonical value as ground truth for this recording. The
display result is therefore a contract test for evidence preservation only.

## Summary evidence audit

| Claim | PLAUD | Revised Sol | Transcript evidence |
| --- | --- | --- | --- |
| 1-6 failure skips to 1-7 | Stated as settled behavior | Kept out of decisions; recorded as an action and open question | Later meeting recap explicitly asks 俊 to confirm the 1-6/1-7 rule |
| Email is the formal confirmation channel | Stated as a decision and follow-up | Omitted | Meeting says the artifact will be meeting notes and later says no mail will be sent for the requested photo |
| Project delivery is delayed | Stated in PLAUD AI advice | No delay or postponement claim | Meeting states only that the current version is difficult with a little over one week remaining |
| `API2` retrieves the hard-drive rule | Stated | Stated | Revised Azure and PLAUD transcripts independently contain `API 二`, a request, and the returned rule; the earlier unsupported classification was incorrect |
| Disputed tray terminology | Mixed `色片`/`舌片` | Uses only operator-configured `舌片` | Original video visibly uses `Tray盤`; exact spoken occurrences still require human adjudication |

The revised summary remains more conservative about unsupported decisions, but
its operator-configured tray terminology is not independently verified. No
single overall superiority claim is justified.

## Final correct-WAV hybrid acceptance

The implemented hybrid path kept `gpt-4o-transcribe` as the only text
authority and ran `gpt-4o-transcribe-diarize` only for alignment-gated speaker
evidence. The primary and final hybrid artifacts were compared after removing
only `speaker`, `speaker_source`, and `speaker_alignment_score`; all 1,186
segments and every `text`, `raw_text`, and `display_text` value were identical.

| Dimension | Correct-WAV hybrid | PLAUD comparison |
| --- | ---: | ---: |
| Duration | 5,609.52 seconds | same meeting |
| Primary segments | 1,186 | 510 |
| Primary raw / display characters | 25,612 / 25,381 | 24,376 normalized lexical characters |
| Primary pipeline elapsed | 723.5 seconds | unavailable |
| Primary transcription requests / processed audio | 22 / 6,509.52 seconds | unavailable |
| Punctuation requests / unmetered | 75 / 4 | unavailable |
| Final diarization elapsed | 683.1 seconds | unavailable |
| Diarization requests / failures | 19 / 0 | unavailable |
| Stable anonymous references | 4 provider maximum | 7 labels |
| Attributed primary segments | 446 of 1,186 (37.6%) | 510 labelled segments |
| Stable / chunk-scoped attributed segments | 439 / 7 | not applicable |
| Attributed aligned-character coverage | 79.6% | comparison baseline |
| Local mapped speaker agreement | 87.4% | comparison baseline |
| Global stable-label agreement | 85.0% | comparison baseline |

The final diarization pass completed all 19 five-minute-or-shorter chunks on
their first request and used four stable anonymous references. The elapsed
figures came from separate measured passes: because diarization was faster
than the 723.5-second primary pipeline and production starts both concurrently,
the expected hybrid wait remains approximately the slower primary duration.
That is an inference from measured passes, not a fresh end-to-end timing claim.

The PLAUD-relative speaker percentages use the best label mapping and are not
a human-labelled diarization error rate. The four-reference provider limit
also means three of PLAUD's seven labels cannot become stable anonymous
references; seven aligned segments therefore remain deliberately
chunk-scoped.

Normalized sequence similarity to the PLAUD transcript was 0.482, which
measures disagreement rather than accuracy. The primary contained 88 exact
`蛇片`, one `舌片`, and 86 `條碼`; 60 of those `蛇片` occurrences came from
one repeated tail sentence. A content-agnostic gzip gate also flags the first
five and final three minutes of this stored artifact. Diarization did not and
must not rewrite primary ASR text.

### Correct-WAV summary model comparison

Aligned anonymous labels were prefixed to unchanged primary wording in the
summary prompt. Each model completed in one metered request.

| Model | Elapsed | Input / output / reasoning tokens | Action items | Decisions | Open questions |
| --- | ---: | ---: | ---: | ---: | ---: |
| Luna | 16.6 seconds | 24,174 / 2,271 / 67 | 12 | 7 | 13 |
| Sol | 42.6 seconds | 24,174 / 2,857 / 1,528 | 7 | 6 | 9 |
| Terra | 19.1 seconds | 24,174 / 1,734 / 104 | 9 | 6 | 8 |

Sol was the most restrained evidence-faithful candidate: it kept the 1-6/1-7
choice open and did not repeat PLAUD's unsupported formal-email or announced
project-delay conclusions. Luna covered more discussion but promoted more
items into actions and risks and retained `MOVING`/`MAS` recognition errors.
Terra combined anonymous owners as `Speaker A/C`, which is not a label present
in the aligned evidence. PLAUD remained more complete but still promoted
pending discussion into settled conclusions. All three local summaries
inherited the primary ASR's ambiguous tray term, so changing the summary model
cannot repair a homophone without independent trusted evidence.

## Full-audio oracle-free follow-up

The full correct WAV was also run without a recording-derived phrase list
through Qwen3-ASR 1.7B at 60-second chunks and the exact production
faster-whisper large-v3 settings at 120-second chunks.

| Candidate | Accepted characters | Load + inference | Gate recovery | Exact `Tray` / `Tray盤` |
| --- | ---: | ---: | ---: | ---: |
| Qwen3-ASR 1.7B | 26,573 | 201.078 seconds | one 60-second loop recovered by two 30-second retries | 0 / 0 |
| faster-whisper production settings | 23,692 | 307.792 seconds | none needed | 3 / 0 |
| Existing Azure artifact | 25,612 raw | 723.5 seconds | eight suspicious minutes were not rejected | 0 / 0 |

An additional deployment-only check ran the official
`qwenllm/qwen3-asr@sha256:fb75b775f089e06e5a1aaebffd421e37505cc630d50c86d889d95ffa45a7e16a`
image as a localhost-only OpenAI-compatible shadow service. It was not connected
to the job queue and did not replace the Azure text authority. After reducing
the unnecessary default 65,536-token context to 8,192 tokens, all 94 one-minute
correct-WAV requests completed in 110.482 provider-request seconds with
1.168/1.487/1.654-second p50/p95/max latency. The service returned 27,361
characters, no chunk exceeded gzip ratio 4.0, and chunk 73 returned 294
characters at ratio 1.646 without the earlier loop.

The deployed service still returned zero exact `Tray` or `Tray盤` occurrences.
It returned 34 `舌片`, 9 `蛇片`, and 28 `條碼` occurrences. Its raw API text
also included repeated `language Chinese<asr_text>` control markers, which were
removed only for measurement. A production adapter would therefore still need
explicit parsing, normalization, evidence, usage, and failure contracts.

On the 5,460–5,520-second interval, display-normalized Qwen versus overlapping
PLAUD segments had sequence similarity 0.8703, while the loop-contaminated
Azure artifact versus PLAUD had similarity 0.2016. This is evidence that the
deployed Qwen candidate is much closer to PLAUD on that interval, not that
PLAUD is correct or that Qwen passed the official-terminology gate.

The generic gate is accepted evidence: Qwen chunk 4,380–4,439.968 seconds
returned 2,504 characters with gzip ratio 41.966 and dominant-repeat share
0.943; its two roughly 30-second retries returned 139 and 155 characters with
gzip ratios 1.471 and 1.472. Qwen is not accepted as a production text
replacement because exact official terminology and human-reference CER/WER
remain unproven.

Automatically feeding 99 strings extracted from original-video frames into
Qwen did not recover `Tray盤`. The same method caused one Azure 60-second
candidate to fall from 172 to 54 characters. This direct visual-context prompt
is rejected. Evidence-constrained post-correction is retained only as a
high-confidence display review candidate for exact visible forms such as
`MoveIn`, `MES3`, and `GroupID`; unresolved homophones remain unchanged.

## Remaining gaps

- `gpt-4o-transcribe-diarize` now supplies conservative anonymous speaker
  metadata, but no human-labelled speaker reference exists and the provider
  can stabilize at most four speakers.
- Generic multi-hypothesis review is deliberately deferred from this change.
  Enabling an independent verifier requires a candidate that clears the
  same-audio terminology/fidelity gate and an explicit ongoing quality/cost
  policy.
- The experimental Qwen shadow API is running locally but has no control-plane
  provider, job claim, immutable artifact, usage settlement, or automatic
  comparison path. Its deployment smoke is not product integration.
- The current stored Azure artifact contains long-text loops in its first five
  and final three minutes. The locally implemented repetition gate flags both
  affected five-minute provider chunks; deployment remains unverified. After
  excluding those spans, only three short adjacent duplicates (`Hello`, an
  acknowledgement, and a goodbye) remain. Diarization cannot determine whether
  those legitimate short repetitions came from separate speakers.
