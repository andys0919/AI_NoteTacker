# Correct HDD WAV blind benchmark

_Measured 2026-07-29 (Asia/Taipei). PLAUD is a comparator, not ground truth._

## Verdict

The implemented MAI/Luna pipeline is materially closer to PLAUD than the old
Azure transcript on the central domain term and produces a more complete,
more uncertainty-aware engineering summary. It does not yet prove overall
superiority:

- transcript terminology is effectively tied with PLAUD without a
  human-listened reference;
- the generated summary covers more late-meeting decisions, risks, and open
  questions, while PLAUD incorrectly hardens some provisional choices;
- PLAUD still wins speaker attribution: 510/510 PLAUD segments have a speaker,
  versus 380/666 alignment-gated MAI segments after the successful speaker-only
  rerun;
- both summaries contain terminology errors, so neither is a perfect
  reference.

## Blind method and source

- Correct source:
  `/tmp/ai-notetacker-hdd.M1Xz3T/hdd-reference.wav`
- WAV SHA-256:
  `33609d7341182581ecbe393313a9263b74f17e8755351d343b1115b4d242848c`
- WAV shape: 179,504,718 bytes, 16 kHz mono 16-bit PCM, 5,609,520 ms
  (93:29.520).
- PLAUD reports 5,609,000 ms for its share, a 520 ms difference.
- MAI received no phrase list, forced locale, filename-derived term,
  stored transcript, or PLAUD text.
- Luna polishing received MAI-derived transcript text only. PLAUD files were
  not opened for this final run until job v4 had reached `completed` and both
  transcript and summary artifacts had been stored.
- The summary used a new Luna request and did not reuse polishing response
  state.

This procedure prevents answer leakage. It does not create human ground truth;
agreement with PLAUD remains provider agreement.

## Run history

| Run | Job/evidence | Outcome |
| --- | --- | --- |
| Direct whole-file MAI probe | `mai-full-direct.json` | The 179.5 MB request ended after 727.694 seconds with `URLError: Broken pipe`; the documented size limit alone did not make one large upload reliable. |
| v1 | `job_a5e639ccecea4fa6936348bd7a32074f` | Failed naturally after three job attempts during external-network failures. |
| v2 | `job_858a2eadbcd94f1b8beecdf4ce23c2e9` | Manually cancelled because the observer used the wrong progress field. This was an operator mistake, not a provider failure. |
| v3 | `job_0013cdfb3500424282648223ccdedea8` | Intentionally cancelled at 2,250,000 processed ms after review found the old worker could accept reordered polish text and under-report retry usage. |
| v4 final blind job | `job_e45045210fc84644a6d8277f0adb48a0` | Completed transcript and summary over all 5,609,520 ms with `transcriptionAttemptCount=0`. |
| v5 speaker-only retry validation | `diarization-retry-v5.json` | Current worker processed 19/19 diarization chunks successfully without rerunning MAI or Luna. |

v4 ran from `2026-07-29T10:40:33.906Z` to
`2026-07-29T11:36:41.348Z`, or 56:07.442 wall time. Primary transcript
generation reached `summary-pending` after about 52:19; the independent
Luna/max summary then took about 3:48.

The final blind job used:

- transcription worker image
  `sha256:d28e74abbaf2e9c73ed6cacbb5eb33aa1b5cb424dc57aad984dd3abd9f9d6b1f`;
- summary worker image
  `sha256:c3b23f6d67796014798bd10e1a477eb43daaa13195de9daf2b74ab12c134db44`;
- control-plane image
  `sha256:245550cde0be7f5bd372710e2121bab01ca9c8c6976c8bb24e583ea3bfcc968a`.

The speaker retry fix was rebuilt as transcription worker image
`sha256:1630ab8ae8c96e3e265690b608a0406b22aea60874b8ad937742aa477cc3109e`.
The final cancellation and malformed HTTP-200 usage-accounting review fixes
were deployed after that speaker-only measurement as
`sha256:e04ef25d0406eb2cb1e8943cc87f4f1f73457e09440866b6b4bcfc1d375dcebd`.

## v4 artifact and usage evidence

| Evidence | Result |
| --- | --- |
| Primary provider/model | `azure-speech-mai-transcribe-1.5` / `mai-transcribe-1.5` |
| Transcript segments | 666/666 raw and display segments non-empty |
| Raw/display characters | 30,375 / 31,138 |
| Display differs from raw | 648 segments, mostly deterministic Simplified-to-Traditional conversion |
| Accepted lexical polish flags | 106 `llm-polished` flags |
| Polishing ledger | 188 provider requests; 174 accepted logical chunks; 13 fallback chunks; 14 unmetered requests |
| Polishing tokens | 690,489 total; 618,468 reasoning-output tokens |
| Summary provider/model | `azure-openai` / `gpt-5.6-luna` |
| Summary effort | `max` |
| Summary request/tokens | 1 request; 86,923 total tokens; 30,203 reasoning-completion tokens |
| Summary structure | 12 key points, 11 decisions, 16 action items, 7 risks, 13 open questions |
| Price status | MAI, polishing, diarization, and summary all remained `unpriced`; no substitute model price was reported |

The polish cost is operationally important: 188 small Luna/max calls consumed
far more reasoning tokens than the one summary call. Higher quality on this
sample therefore does not imply an efficient final design.

## Transcript terminology comparison

Counts are literal occurrences in each stored artifact. “Correct share” is
only a spelling-consistency indicator: it treats `舌片` as the requested term
and the listed variants as errors, but does not replace human listening.

| Artifact | `舌片` | Listed error variants | Correct share | `條碼` | `硬碟` |
| --- | ---: | ---: | ---: | ---: | ---: |
| MAI raw | 31 | 10 (`蛇片` 9, `色片` 1) | 75.6% | 35 | 12 |
| MAI + Luna display | 28 | 5 (`蛇片` 4, `色片` 1) | 84.8% | 35 | 18 |
| PLAUD raw | 32 | 6 (`色片` 3, `射片` 2, `蛇片` 1) | 84.2% | 31 | 11 |
| PLAUD polished | 31 | 6 (`色片` 3, `射片` 2, `蛇片` 1) | 83.8% | 31 | 12 |

Luna removed five `蛇片` occurrences, but also changed or obscured some
already-correct terms:

- 180–210 s: `蛇片` became `蝦皮`;
- 420–450 s: `一條舌片` became `一條 shelf`;
- 780–810 s: `上傳舌片用的` became `上傳影片用的`;
- 930–960 s: `舌片條碼` became `晶片條碼`;
- 5520–5550 s: `舌片照片／規則` became `晶片照片／規格`.

Conversely, 1470–1500 s shows the desired generic correction: three `蛇片`
occurrences became `舌片` from local workflow context, without a supplied
phrase list.

The result is close to PLAUD on the named term, not perfect. A count-only
claim that Luna “won” would hide its lost mentions and plausible-but-wrong
replacements.

## Speaker evidence and unstable network

The v4 artifact exposed a retry gap:

| Run | Successful chunks | Failed chunks | Attributed primary segments | Stable references |
| --- | ---: | ---: | ---: | ---: |
| v4 before speaker transport retry | 4/19 | 15 | 81/666 (12.2%) | 0 |
| v5 current worker, speaker-only | 19/19 | 0 | 380/666 (57.1%) | 2 |
| PLAUD comparator | n/a | n/a | 510/510 (100%) | 7 named/anonymous labels |

The v4 cloud ledger recorded 19 diarization requests, 15 failed chunks,
1,200,000 successful audio ms, and 15 unmetered requests. Code inspection
showed that diarization retried only `404 DeploymentNotFound`; HTTP 400 and
DNS/timeout/reset/broken-connection failures were single-shot.

The current worker now retries an identical HTTP 400 once after two seconds
and identical transient transport requests after 2, 10, and 30 seconds.
Focused tests exercised both branches. The v5 live rerun happened to need no
retry (`requestCount=19`, `unmeteredRequestCount=0`), so it proves complete
live operation but not a live transient-failure recovery.

The v5 run took 645.386 seconds. Its two stable anonymous labels map best to
PLAUD `Speaker 4` and `Speaker 1` with 85.4% overlapping-duration agreement.
Including chunk-scoped labels and mapping each to its dominant PLAUD speaker
also yields 85.4%. This is provider-relative agreement, not a human-labelled
diarization error rate. PLAUD still has the clear product advantage because
all of its segments are attributed and it exposes seven labels; the Azure
reference interface stabilized only two speakers in this run.

## Summary comparison: evidence grill

Both summaries cover all five headline topic groups:

1. initial/self-check and two-stage start;
2. `舌片`/hard-drive barcode and MVS API flow;
3. insertion, binding, outage, and recovery exceptions;
4. UI, tray inspection, line selection, and future layout;
5. scope change, ownership, missing inputs, CT, and schedule risk.

The differences matter more than raw section count:

| Question | MAI + Luna summary | PLAUD summary | Transcript evidence and judgment |
| --- | --- | --- | --- |
| Does it preserve provisional status for a failed 1-6 insertion? | Treats retry/leave-empty/continue-at-1-7 as open and asks for upper-level confirmation. | States that the system skips the failed slot and continues. | 2130–2274 s records an Andy-default flow to leave 1-6 empty and continue at 1-7, but also repeatedly says the director's answer is pending. Best wording must include both the provisional default and pending approval. Luna is safer; PLAUD is too final. |
| Is power-loss continuation completely decided? | Keeps the formal recovery flow and state recognition open. | Says the remaining chassis stays and processing continues. | 2464–2529 s records manufacturing's preference to keep and continue, followed by unresolved questions about how the system recognizes state. PLAUD captures the direction; Luna better preserves the implementation gap. |
| Was email adopted as the formal future change-control channel? | Does not claim that decision. | Says the meeting agreed on email confirmation and a formal change-review mechanism. | 161 s only offers email as an option; 2070 s asks whether an “actual email” is wanted and answers that meeting minutes will be prepared; 5580 s says this item will not be emailed. No clear agreement supports PLAUD's strong wording. |
| Does it cover the late insertion-order discussion? | Records 1–22 versus 1–132, gaps, duplicates, non-contiguous order, edit mode, and confirm-time validation as open. | Compresses this to a future custom-order feature outside the current version. | 5130–5370 s contains a long unresolved validation discussion. Luna preserves materially more engineering detail. |
| Does it expose schedule and implementation risk? | Records the explicit “8月6號會滑掉” statement, CT/network risk, AI-classification limits, and force-sensor recovery gaps. | Mentions general delay and CT risk in the AI suggestions. | 4620–4650 s directly supports the August 6 risk. Luna is more traceable and actionable. |
| Are terms clean? | Uses bad terms including `蝦皮畫面` and `晶片條碼`; `Google ID`/`IMEI` remain uncertain without listening. | Uses `NVS`, `SMPSID`, `poker id`, and `色片（舌片）`. | Both summaries inherit or add terminology noise. Repeated meeting evidence supports `MVS` and separately lists `SN`, `PSID`, and `PN`; the remaining ID words require human listening. Neither summary is a terminology oracle. |
| Can actions be assigned to speakers? | Produces 16 actions but no reliable real-person ownership because speaker evidence was partial during v4. | Assigns several actions to Speaker labels and Joseph. | PLAUD's 510/510 attribution gives it a clear ownership advantage, even though its labels are not all real names. |

## Overall comparison

- **Primary text:** near tie. MAI + Luna has a slightly higher requested-term
  consistency ratio and more `條碼`/`硬碟` mentions, but fewer surviving
  `舌片` mentions and several wrong lexical replacements.
- **Engineering summary:** MAI + Luna is stronger on coverage, explicit risks,
  open questions, and avoiding unsupported finality. PLAUD is shorter and
  easier to scan by topic.
- **Speaker/owner evidence:** PLAUD remains materially better.
- **Faithfulness:** MAI + Luna wins the clearest disputed examples by keeping
  uncertainty, but its own terminology errors prevent a “perfect” claim.

The honest conclusion is: on this recording and the listed literal-term count
proxy, this implementation is close to PLAUD and can exceed PLAUD's summary
usefulness for engineering handoff. It does not yet exceed PLAUD as a complete
meeting-note product because speaker coverage and global terminology
consistency remain weaker.

## Reproducible artifacts

| Artifact | SHA-256 |
| --- | --- |
| v4 job JSON | `aa3919101d0a7bd31688af27efbdf4c39be7ba918a7e89bd47d542702821872d` |
| MAI raw text | `03fea55520f516a8c664a211776a444bfe3a6c762212846f681b6d4fa86f6918` |
| Luna display text | `7b02e77e267dc5c0c4e9ce40cda266e59c049811cd5950c7341464535934a370` |
| Luna summary | `b6a6f9ef980a45ba064a4a52d6b72b9c5d479dd43f033caec1e215ae9361695a` |
| PLAUD share JSON | `8891857f63601f7b2beab62da3d20abd7d2f010e87cceb6e051bbe3fff2af4aa` |
| PLAUD summary | `036e971cad13560a776ad5f0b9b6e5114ea48caa391f3cfffcb711ab28dada25` |
| v5 speaker-only result | `af20f6ecd04ed533d6cc6564e025976e617dd91f20d8d26a669923efa91f14df` |
