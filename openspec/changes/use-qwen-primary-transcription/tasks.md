## 1. Contract

- [x] 1.1 Validate the Qwen primary-provider OpenSpec change strictly.

## 2. Implementation

- [x] 2.1 Add Qwen provider readiness, labels, and provider-specific model
  selection to the control plane.
- [x] 2.2 Add the minimal Qwen OpenAI-compatible adapter with 60-second chunks,
  protocol cleanup, shared quality retry, and optional Azure speaker evidence.
- [x] 2.3 Register Qwen in the transcription worker and preserve full progress,
  cancellation, evidence, and usage callbacks.
- [x] 2.4 Add the official Qwen service to Compose and configure Qwen as the
  default for future claims.

## 3. Verification

- [x] 3.1 Run focused control-plane and worker tests plus build/Compose
  validation.
- [x] 3.2 Rebuild and deploy the affected services, verify Qwen health, and run
  one live worker-path smoke.
- [x] 3.3 Blind-run multiple stored recordings through Qwen and record
  Qwen-versus-Azure evidence without feeding comparison text to Qwen.
- [x] 3.4 Review the final diff against repository standards and this spec.
