# Multilingual Faithful Transcription Design

## Problem

The current cloud pipeline asks `gpt-4o-transcribe` for text, asks a second model
to add punctuation without changing words, and then summarizes the resulting
text. The punctuation fidelity guard works as intended, but it also means that
speech-recognition errors such as homophones cannot be repaired there. The
summary model can then turn an uncertain or malformed phrase into a confident,
unsupported statement.

The product must preserve the language that was spoken, including code-switching
within a recording. Chinese output must use Traditional Chinese. Taiwanese
Hokkien should use readable Traditional Chinese characters where the evidence is
strong and include a Tai-lo candidate where it is not. No normalization,
correction, or summary step may silently destroy the original transcription.

## Goals

- Preserve the provider's original transcription as immutable evidence.
- Preserve spoken languages rather than translating the recording.
- Normalize confidently identified Chinese text to Traditional Chinese without
  rewriting non-Chinese text or foreign proper nouns.
- Improve recognition of domain terms, names, numbers, units, and model numbers.
- Represent uncertain recognition explicitly instead of guessing silently.
- Keep punctuation restoration unable to change words.
- Prevent summaries from introducing facts, actions, risks, or questions that
  are not explicit in the transcript.
- Measure quality on real multilingual recordings before changing providers or
  models.

## Non-goals

- Guarantee perfect machine transcription for every language, accent, or audio
  condition.
- Translate non-Chinese speech into Chinese.
- Silently replace uncertain Taiwanese Hokkien with a guessed Mandarin phrase.
- Train or deploy a custom speech model before benchmark evidence shows that
  prompt and glossary support are insufficient.
- Add unrelated recording, scheduling, authentication, or billing features.

## Architecture

The pipeline will use evidence-preserving stages:

```text
audio
  -> primary speech recognition
  -> immutable raw transcript
  -> language-aware Traditional Chinese normalization
  -> punctuation-only restoration
  -> terminology and uncertainty analysis
  -> display transcript plus review flags
  -> evidence-constrained summary
```

Each stage receives the previous stage's value and returns a new value. It does
not overwrite the input that it was given. Deterministic rules belong in code;
model prompts define only probabilistic recognition or extraction behavior.

## Transcript Artifact Contract

Transcript artifacts will be versioned. Each segment will retain:

- `rawText`: exact text returned by the speech-recognition provider.
- `displayText`: text after approved normalization and punctuation.
- `startMs` and `endMs`: the best available timing evidence. Approximate timing
  must remain distinguishable from provider timing.
- `language`: a BCP-47 language tag when confidently known, otherwise `und`.
- `languageConfidence`: provider confidence when available, otherwise omitted.
- `reviewFlags`: zero or more structured uncertainty records.

A review flag contains the original text, zero or more candidates, a reason such
as `proper-name`, `domain-term`, `number`, `unit`, `mixed-language`, or
`taiwanese-uncertain`, and the segment timing. A flag is not an accepted edit.

Legacy consumers that only read `text` will receive `displayText`. The artifact
will keep `rawText` so exports and the operator UI can expose the evidence and a
future correction workflow can record an explicit decision.

## Language Policy

- The system does not set one global transcription language for every job.
- A caller-supplied primary language is treated as a recognition hint, not as an
  instruction to translate other languages.
- Unknown-language jobs use automatic detection.
- Mixed-language text keeps the language that was spoken.
- Traditional Chinese conversion runs only on spans confidently classified as
  Chinese. Uncertain CJK spans are preserved and flagged so Japanese kanji and
  proper names are not blindly converted.
- Chinese conversion uses a maintained conversion library and a fixed,
  test-covered conversion profile. A text-generation model does not perform
  unrestricted Simplified-to-Traditional rewriting.
- Taiwanese Hokkien uses Traditional Chinese characters when the transcription
  evidence is strong. Uncertain text remains visible and receives a Tai-lo
  candidate in a review flag. The candidate never silently replaces the raw
  text.

## Recognition Context and Glossaries

The transcription prompt will be generated from explicit workflow context:

- primary language hint, if known;
- output policy: preserve spoken languages and use Traditional Chinese for
  Chinese text;
- workflow vocabulary;
- known company, person, product, acronym, unit, and model names.

Glossaries are selected by `submissionTemplateId`; they are not one global list
sent to every job. The sales activity report path must submit or normalize to
the `sales` workflow template. Its initial glossary will cover only verified
terms used by that workflow. User- or organization-managed vocabulary is a
separate future capability unless required by benchmark failures.

Prompt context is a recognition hint. It must not tell the model to insert a
glossary term that was not spoken.

## Punctuation and Correction Boundaries

The existing punctuation fidelity guard remains: the accepted result must have
exactly the same non-punctuation, non-whitespace characters as its input.
Punctuation failure keeps the unpunctuated input and does not fail the job.

Word correction is not added to the punctuation prompt. Terminology analysis is
a separate component that may propose candidates but may not mutate `rawText`.
Deterministic Traditional Chinese conversion may update `displayText`; all other
word changes require explicit evidence and are represented as review flags.

## Summary Contract

The summary stage consumes the display transcript together with its review
flags and follows these rules:

- Extract only statements explicitly supported by transcript text.
- Do not convert a malformed phrase or correction candidate into a fact.
- Use empty arrays when no explicit action, decision, risk, or open question was
  spoken.
- Do not create generic follow-up tasks merely because they would be sensible.
- Keep numbers, dates, names, units, and model identifiers verbatim unless the
  transcript contains an accepted deterministic normalization.
- Avoid repeating the same fact across the summary and every structured list.
- Use concise Traditional Chinese for narrative fields while preserving foreign
  proper nouns in their original form.

Sales activity reports use the existing `sales` profile. The `general` profile
is not a fallback for a request already identified as a sales report.

## Operator Experience

The default transcript view shows `displayText`. A segment with review flags is
visibly marked and can reveal:

- the immutable raw text;
- candidate spellings or Tai-lo;
- the reason it was flagged;
- the audio time range.

The initial implementation does not block job completion on human review.
Exports include the display transcript and retain raw text and review metadata
in JSON. A later explicit correction action can be added without changing the
artifact's evidence model.

## Failure Handling

- Speech-recognition failure remains a transcription-stage failure.
- Language classification uncertainty preserves the text and skips destructive
  normalization.
- Traditional Chinese conversion failure preserves the raw span and records a
  review flag.
- Punctuation failure preserves its input under the current best-effort policy.
- Terminology analysis failure preserves the display transcript with no silent
  correction.
- Summary validation failure remains an explicit summary-stage failure and does
  not store a partial artifact.

No fallback may translate the transcript or erase an earlier stage's evidence.

## Verification

A versioned, redacted evaluation corpus will contain representative, legally
usable recordings and reference transcripts for:

- Traditional and Simplified Mandarin;
- Mandarin-English code-switching;
- Taiwanese Hokkien and Mandarin-Hokkien code-switching;
- English and at least one other language present in real usage;
- names, companies, dates, money, quantities, `kW`, acronyms, and model numbers;
- quiet, fast, and moderately noisy speech.

The benchmark reports:

- character error rate for Chinese and word error rate where appropriate;
- spoken-language preservation rate;
- Traditional Chinese normalization accuracy;
- proper-name and domain-term accuracy;
- numeric, date, unit, and model-identifier accuracy;
- unsupported-summary-claim count;
- explicit action and decision precision/recall;
- latency and provider usage by stage.

Tests also assert that `rawText` is immutable, non-Chinese spans are not
converted, punctuation cannot change words, empty summary sections remain
empty, and legacy artifacts still render.

## Model Selection and Rollout

The current `gpt-4o-transcribe` deployment is the baseline, not an assumed final
winner. A candidate model or Azure Speech configuration replaces it only when
the same evaluation corpus shows a material improvement in the high-risk
metrics without unacceptable latency or cost.

Rollout order:

1. Add versioned raw/display artifact support and compatibility reads.
2. Add workflow-specific prompt and glossary construction.
3. Add conservative language-aware Traditional Chinese normalization.
4. Add structured review flags and operator display.
5. Tighten and regression-test the summary contract and sales routing.
6. Run the multilingual benchmark against the baseline and any candidate model.
7. Change the production model only if benchmark evidence justifies it.

Each step is independently deployable and reversible. Existing artifacts remain
readable throughout the rollout.

## Scope Boundaries

Expected write scope is limited to transcription-worker recognition,
normalization, punctuation integration, summary prompting, transcript artifact
types and persistence, the job-detail transcript UI, workflow-template routing,
tests, and the relevant OpenSpec documents. Existing unrelated worktree changes
must be preserved. Recording capture, authentication, scheduling policy, and
unrelated governance behavior are no-touch areas.
