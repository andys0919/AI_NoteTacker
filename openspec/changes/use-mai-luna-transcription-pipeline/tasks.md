## 1. Contract

- [x] 1.1 Add and strictly validate the MAI/Luna pipeline OpenSpec change.

## 2. Implementation

- [x] 2.1 Add MAI provider identity, readiness, model selection, and cloud
  routing to the control plane.
- [x] 2.2 Add the minimal MAI adapter with 30-second verbatim chunks, no phrase
  list, fixed three-request concurrency, bounded HTTP 400 and transport retry,
  shared HTTP-200 quality retry, and raw evidence.
- [x] 2.3 Send `reasoning.effort=max` for guarded Luna transcript polishing and
  a separate Luna summary request.
- [x] 2.4 Configure MAI as the future-claim default without committing secrets.
- [x] 2.5 Add bounded identical-request HTTP 400 and transport retries to the
  optional diarization speaker-evidence pass.

## 3. Verification

- [x] 3.1 Run focused worker, control-plane, build, Compose, and strict
  OpenSpec checks.
- [x] 3.2 Rebuild affected services, verify live readiness, and persist the
  MAI/Luna max policy for future claims.
- [x] 3.3 Run the correct HDD WAV end to end and compare the generated summary
  with PLAUD without using PLAUD in either generation prompt.
- [x] 3.4 Review the final diff against repository standards and this spec.
