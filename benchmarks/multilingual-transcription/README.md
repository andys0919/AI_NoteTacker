# Multilingual transcription benchmark

This directory defines the versioned evaluation contract; it does not contain
or claim results for a real multilingual corpus. Add only redacted recordings
that the project is legally permitted to process, plus human-verified reference
transcripts. Do not fill missing languages or results with synthetic scores.

Each candidate and the current production baseline must process the same corpus.
Store its output as a results JSON with `schemaVersion`, `corpusVersion`,
`provider`, `model`, and one entry per case containing `id`, `rawText`,
`displayText`, structured summary claims/actions/decisions, `latencyMs`, and
provider `usage` counters.

Run:

```bash
python3 scripts/evaluate_multilingual_transcription.py \
  benchmarks/multilingual-transcription/manifest.json \
  benchmarks/multilingual-transcription/results/baseline.json
```

The report covers Chinese character error rate, other-language word error rate,
spoken-language span preservation, Traditional Chinese normalization, domain
entities, numeric/unit/model literals, unsupported summary claims, explicit
action and decision precision/recall, latency, and usage. Exact-match lists are
intentional: high-risk literals and claims must not be silently normalized.

Do not replace the production model because a candidate has a newer name.
Replacement requires measured improvement on the same legally usable corpus,
especially domain entities, numerics, language preservation, and unsupported
claims, without unacceptable latency or usage cost.
