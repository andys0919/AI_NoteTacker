## Context

The worker already provides prepared WAV input, chunk cleanup, progress,
cancellation, immutable raw/display transcript evidence, Traditional Chinese
normalization, content-quality retry, and an independent summary worker. MAI
uses a different Azure Speech multipart contract from the current Azure OpenAI
transcriber. The current Luna transcript pass only adds punctuation and does
not send a reasoning effort; the Azure summary path also records
`cloud-default` without sending the configured effort.

The correct HDD WAV blind sample established that 30-second MAI uploads were
stable while 60-second PCM uploads could be reset after a long upload. PLAUD
is useful as an external comparator but is not authoritative ground truth.

## Goals / Non-Goals

- Goals:
  - make MAI-Transcribe 1.5 the default primary text provider;
  - preserve every MAI raw result before any language-model correction;
  - use two independent Luna max requests for polishing and summary;
  - reject unsafe polishing output and retain the raw-derived display fallback;
  - measure the generated summary against PLAUD without answer leakage.
- Non-Goals:
  - feed PLAUD, stored Azure text, filenames, or benchmark answers into MAI or
    Luna prompts;
  - add a phrase-list or web-search correction subsystem;
  - silently replace failed MAI text with Qwen, Whisper, or another ASR;
  - rewrite historical transcript artifacts.

## Decisions

### Add one thin MAI adapter

The MAI adapter reuses the existing transcriber seam and overrides only the
Azure Speech URL, subscription-key header, multipart fields, 30-second chunk
boundary, three-request concurrency, and response normalization. Requests set
`enhancedMode.enabled=true`, `model=mai-transcribe-1.5`, and
`transcribeStyle=verbatim`. They omit `phraseList` and `locales`.

MAI requests carry no prior-chunk prompt, so three chunks may run independently
and their results are restored to timestamp order before artifact generation.
The fixed concurrency is based on the successful 24-request blind validation;
it avoids adding another operator setting while reducing measured MAI-only
runtime from roughly three hours to roughly one hour for the HDD recording. If
one concurrent chunk still fails after its bounded retry, queued chunks are
cancelled before the attempt fails so the worker does not keep spending on work
that cannot be persisted.

### Keep raw and polished transcript evidence separate

The adapter stores MAI text as `rawText`. Traditional Chinese normalization
and the Luna polish result are stored as `displayText`. The polish prompt may
fix obvious ASR homophones and technical spellings, punctuation, and sentence
boundaries, but may not translate, summarize, remove utterances, invent facts,
or change numeric evidence. A deterministic guard rejects empty, repetitive,
large-drift, or number-changing output. Rejected or failed polish calls keep
the raw-derived display text.

Accepted lexical changes add a review flag so an operator can inspect the
original and proposed text. Luna never becomes the source of `rawText`.

### Send reasoning effort explicitly

The shared Responses client accepts an optional reasoning effort and serializes
it as `reasoning.effort`. Transcript polishing and Azure summary generation
both use `gpt-5.6-luna` with `max`. Each call uses `store=false`; the summary
request does not reuse a polishing response ID or reasoning state.

### Keep retries bounded and oracle-free

MAI retries an HTTP 400 response once with the identical audio and definition.
For transient DNS, timeout, reset, or broken-connection failures, it retries the
same request after 2, 10, and 30 seconds before failing the chunk. This bounded
backoff tolerates the observed unstable external network without restarting the
whole job after a two-second outage. The existing repetitive-content quality
gate can retry an HTTP-200 response up to its current bound. Luna polishing
retries one HTTP 400 once. A successful polishing retry reports provider
attempts independently from the one accepted logical chunk. Retries do not add
a phrase list, PLAUD text, or prior benchmark output.

Optional diarization speaker evidence follows the same oracle-free transport
policy: HTTP 400 retries the identical request once after two seconds, while
DNS, timeout, reset, or broken connection retries after 2, 10, and 30 seconds.
A final diarization failure leaves speaker evidence partial but never changes
or fails valid MAI transcript text.

### Keep existing providers available

Qwen, Azure OpenAI transcription, and self-hosted Whisper remain explicit
operator-selectable fallbacks. Provider latching keeps already claimed and
completed jobs unchanged. MAI policy storage always normalizes to the configured
MAI model, and the worker refuses a claimed MAI model that differs from its
runtime model before sending audio.

## Risks / Trade-offs

- Luna can make a plausible but wrong correction. Mitigation: immutable raw
  evidence, numeric and drift guards, visible review flags, and raw fallback.
- MAI 30-second chunks increase request count. Mitigation: the boundary is
  based on observed transport stability, three chunks run concurrently, and
  the boundary can be revisited only with measured larger-upload reliability.
- `max` increases Luna latency and token use. This is the operator's explicit
  quality-first choice; usage remains separately metered for polish and
  summary.
- PLAUD agreement does not prove correctness. Report agreement and concrete
  disagreements separately from any human-reference claim.

## Migration Plan

1. Add and validate the OpenSpec contract.
2. Implement and test MAI, guarded Luna max polishing, and Luna max summary.
3. Configure the southeast Asia Speech resource without committing secrets.
4. Rebuild the affected services and set MAI/Luna max as the global policy for
   future jobs.
5. Keep the bundled Qwen runtime behind its explicit Compose profile so an
   unused local ASR service neither starts nor gates the MAI worker.
6. Run the correct HDD WAV end to end and compare the generated summary with
   PLAUD.

Rollback is an admin provider switch to Qwen, Azure OpenAI transcription, or
self-hosted Whisper. Existing MAI jobs remain latched.
