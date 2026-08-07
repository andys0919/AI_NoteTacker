# Change: Fall back to Azure only when Codex quota is exhausted

## Why

Local Codex should remain the default summary runtime, but a depleted ChatGPT
Codex allowance must not stop meeting summaries when the existing Azure Luna
deployment is available. Falling back on generic errors would create
unintentional Azure spend and hide operational failures.

The user approved this boundary on 2026-08-06: try Local Codex first and use
Azure automatically only for an explicit subscription/quota exhaustion state.

## What Changes

- Read Codex's structured `account/rateLimits/read` state before a local summary.
- Invoke the existing Azure Responses summary transport only when Codex reports
  a non-null `rateLimitReachedType`.
- Never fall back for timeout, authentication, network, schema, configuration,
  or other model failures, and atomically reserve at most one Azure request per
  summary job before calling Azure.
- Keep `local-codex` as the only operator-selectable and claimable primary
  provider; Azure remains an internal fallback, not a policy option.
- Attribute Azure fallback usage, pricing, request counts, and failures to
  `azure-openai` under the scheduler-issued summary lease.
- Restore Azure summary credentials only to the summary worker. Do not expose a
  key or OAuth-token field to the control plane, browser, logs, or Codex child.

## Impact

- Affected specs: `meeting-summary-generation`, `cloud-usage-governance`,
  `deployment-readiness`
- Affected code: Codex quota probe, summary worker orchestration, Azure Responses
  summarizer, summary callback validation/settlement, Compose, tests, and docs
- Operator policy and queued job snapshots remain `local-codex`; completed
  fallback artifacts record the same Luna model while their usage ledger records
  the actual Azure provider.
