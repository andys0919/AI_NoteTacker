## 1. Contract

- [x] 1.1 Add and strictly validate the simplified MAI pipeline OpenSpec change.

## 2. Implementation

- [x] 2.1 Remove Luna transcript-polishing and diarization wiring from the
  transcription worker.
- [x] 2.2 Keep deterministic Traditional Chinese display normalization for
  Chinese MAI results while preserving raw provider text.
- [x] 2.3 Isolate Luna credentials and max reasoning to the summary worker.
- [x] 2.4 Update focused tests and operator documentation.
- [x] 2.5 Remove shared `.env` injection from the non-AI recording worker and
  pass only its active runtime settings.
- [x] 2.6 Remove the superseded punctuation-restoration requirements and
  unreachable provider implementation while retaining historical ledger and
  artifact compatibility.

## 3. Verification

- [x] 3.1 Run focused worker tests, Compose configuration checks, and strict
  OpenSpec validation.
- [x] 3.2 Rebuild the affected workers and verify the live runtime
  configuration.
- [x] 3.3 Deploy the approved `high` summary effort and verify the live worker.
- [x] 3.4 Verify the resolved recording-worker environment excludes AI, admin,
  and sharing credentials without printing secret values.
- [ ] 3.5 Deploy the approved `max` summary effort after the summary-key rotation
  gate and verify the live worker.
