## Context

The Azure transcription path currently produces one provider text value, optionally restores punctuation under a strict word-fidelity guard, splits the text into approximate segments, and stores only the resulting segment text. That guard correctly prevents punctuation from corrupting words, but the artifact cannot distinguish provider evidence from later presentation changes. The summary prompt then receives malformed words without uncertainty metadata and is encouraged to fill six detailed sections.

Real recordings include Mandarin, Taiwanese Hokkien, English, other languages, and code-switching. A single fixed Chinese prompt or unrestricted text rewrite would improve some examples while corrupting others. The active `update-cloud-summary-azure-responses` change already owns Responses transport, output validation, usage, timeouts, and punctuation metering; this change must compose with it rather than alter those contracts.

## Goals / Non-Goals

**Goals:**
- Retain immutable ASR evidence while providing a backward-compatible display transcript.
- Preserve spoken languages and normalize only confidently Chinese text to Traditional Chinese.
- Make uncertain domain terms, Taiwanese Hokkien, names, numbers, and identifiers visible without silently guessing.
- Bias recognition with explicit workflow context and verified glossaries.
- Prevent summaries from converting uncertain text into unsupported facts.
- Compare model changes on a repeatable multilingual corpus.

**Non-Goals:**
- Promise perfect automatic recognition for every language or accent.
- Translate non-Chinese speech.
- Add a blocking human-review lifecycle.
- Train or deploy a custom speech model without benchmark evidence.
- Change Responses transport, cloud settlement, or unrelated scheduling behavior.

## Decisions

### 1. Extend transcript segments instead of replacing their existing text field

Each new segment keeps the existing `text`, `startMs`, and `endMs` compatibility shape and adds optional `rawText`, `displayText`, `language`, `languageConfidence`, `timingSource`, and `reviewFlags`. For new artifacts, `text` equals `displayText`; `rawText` retains the provider output before normalization or punctuation. Legacy artifacts without the new fields continue to deserialize and render.

Alternative considered: replace `text` with a new nested versioned object. Rejected because every dashboard, export, repository, worker callback, and legacy artifact consumer would require a coordinated breaking migration.

### 2. Keep every transformation as a derived value

The worker captures raw provider text first, then produces separate normalized and punctuated text. Traditional Chinese conversion may update display text but never raw text. Terminology analysis emits review flags and does not mutate raw text.

Alternative considered: let one strong model rewrite the transcript and summary in one call. Rejected because the system could not attribute or audit word changes and a fluent hallucination would replace the only evidence.

### 3. Normalize Chinese conservatively with a deterministic converter

The worker uses a maintained Simplified-to-Traditional conversion library with a fixed profile. Conversion is applied only when the job or span is confidently Chinese. Mixed or uncertain CJK text is preserved and flagged, avoiding blind conversion of Japanese kanji and proper nouns. Provider language evidence is preferred; otherwise conservative script and workflow evidence may identify a Chinese span, and uncertainty skips conversion.

Alternative considered: ask the punctuation or summary model to produce Traditional Chinese. Rejected because those calls could rewrite meaning and cannot provide deterministic regression guarantees.

### 4. Generate recognition context from explicit workflow templates

The worker builds the transcription prompt from the output policy, caller language hint, workflow template, and a small verified glossary. Sales report ingestion normalizes to the existing `sales` template. A glossary biases recognition but does not authorize insertion of terms that were not spoken.

Alternative considered: use one global industrial glossary. Rejected because irrelevant proper nouns can bias unrelated multilingual meetings.

### 5. Represent word uncertainty as data

Review flags contain the original text, candidates, reason, segment timing, and optional evidence. High-risk categories include proper names, organizations, domain terms, numbers, dates, money, units, model identifiers, mixed-language spans, and uncertain Taiwanese Hokkien. Taiwanese candidates use Traditional Chinese characters where supported and may include Tai-lo; candidates never silently replace raw text.

The initial implementation remains non-blocking. It provides review evidence but does not introduce an accept/reject mutation API.

Alternative considered: automatically accept a text model's highest-ranked candidate. Rejected because a ranking is not audio-grounded proof.

### 6. Make summary extraction evidence constrained

The existing six-field JSON schema remains compatible, but the prompt requires empty arrays when the transcript contains no explicit item. It prohibits generic inferred follow-ups, risks, and questions; instructs the model not to resolve review flags; preserves high-risk literals; and limits repetition. Sales reports use the existing sales profile.

Alternative considered: add a second summary model to fact-check the first. Rejected initially because two text-only models share the same corrupted transcript evidence and add cost without recovering the audio.

### 7. Benchmark before changing the production ASR provider

The current `gpt-4o-transcribe` deployment is the baseline. The evaluation corpus measures Chinese character error rate, other-language word error rate, language preservation, Traditional Chinese normalization, entity and numeric accuracy, unsupported summary claims, latency, and usage. Another OpenAI model or Azure Speech configuration replaces the baseline only after measured improvement on high-risk metrics.

## Risks / Trade-offs

- Probabilistic language identification can misclassify short CJK spans → preserve text and skip conversion whenever confidence is unavailable or ambiguous.
- Storing raw and display text increases artifact size → keep the extension segment-local and exclude heavy bodies from list APIs.
- Workflow glossaries can bias recognition toward an unspoken term → keep glossaries small, explicit, and benchmark false insertions.
- Taiwanese Hokkien orthography may have several valid representations → retain raw text and present Tai-lo only as a candidate when uncertain.
- Additional review metadata can imply more confidence than exists → label candidates as suggestions and never as accepted corrections.
- Existing uncommitted Azure Responses work touches the same worker files → implement surgical patches against the current live file contents and run both changes' regression suites.

## Migration Plan

1. Add optional domain types and compatibility readers for extended transcript segments.
2. Add worker-side raw/display construction with no UI behavior change.
3. Add deterministic Chinese normalization and workflow prompt construction behind the existing provider route.
4. Add review flags and on-demand operator rendering/export support.
5. Tighten summary prompting and sales workflow routing.
6. Run targeted, full, and OpenSpec validation before deployment.
7. Keep the existing model unless a redacted multilingual benchmark proves a better candidate.

Rollback removes production emission and UI rendering of optional fields; legacy `text` remains available, so stored artifacts remain readable.

## Open Questions

There are no blocking design questions. The exact next ASR provider and any future custom vocabulary service remain evidence-driven rollout decisions rather than implementation assumptions.
