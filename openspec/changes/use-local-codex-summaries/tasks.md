## 1. Contract

- [x] 1.1 Add and strictly validate the local-Codex summary change.
- [x] 1.2 Update current project, README, worker, and handoff contracts.

## 2. Control plane

- [x] 2.1 Make `local-codex` the only selectable and claimable summary provider.
- [x] 2.2 Normalize a persisted retired summary policy to `local-codex`.
- [x] 2.3 Remove Azure summary readiness inputs from runtime configuration and UI.
- [x] 2.4 Replace the one-option summary provider selector with a read-only Local
  Codex route status while preserving policy-save compatibility (ticket #8).

## 3. Worker and pricing

- [x] 3.1 Retire Azure Responses summary selection and active readiness configuration.
- [x] 3.2 Route every claimed summary to Codex CLI as its primary path with the latched model.
- [x] 3.3 Stop live Luna retail-price refresh while preserving historical pricing.
- [x] 3.4 Isolate the tool-free Codex subprocess from transcript prompt injection
  and worker service credentials.

## 4. Verification and rollout

- [x] 4.1 Run targeted control-plane and summary-worker tests and builds.
- [x] 4.2 Verify the Local Codex cutover Compose contained no Azure summary endpoint/key wiring; later fallback wiring is scoped to summary-worker.
- [x] 4.3 Deploy the canonical production stack and verify live policy/runtime state.
- [x] 4.4 Move production authentication to the dedicated summary-worker Codex
  volume and verify the Business plan, host-account isolation, and fail-closed
  Azure configuration after recreation.
