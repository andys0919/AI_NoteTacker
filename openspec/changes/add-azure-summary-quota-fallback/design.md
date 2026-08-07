## Context

The current summary worker runs `codex exec --json` with a protected
host-managed ChatGPT login. Codex's exec JSON stream preserves only a human
error message for a failed turn, so matching error text cannot safely authorize
a paid fallback. The same pinned Codex CLI exposes a structured app-server
`account/rateLimits/read` response with `rateLimitReachedType`.

The repository already contains the Azure Responses transport, strict summary
schema validation, Luna pricing, lease-scoped usage settlement, and tests from
the earlier cloud-summary path. Reusing those parts is smaller and safer than a
new provider framework.

## Goals / Non-Goals

- Goals: Local Codex first, explicit-quota-only fallback, one Azure request,
  credential isolation, and honest Azure usage settlement.
- Non-goals: native Codex account switching, accepting an OAuth token in the
  product, exposing Azure as an operator choice, persisting a global fallback
  mode, retrying Azure, or changing the summary artifact schema.

## Decisions

### Structured fail-closed quota detection

The Codex summarizer probes `account/rateLimits/read` over a short-lived
app-server stdio process. It returns an exhausted state only when the
backward-compatible primary `rateLimits` snapshot has a non-null
`rateLimitReachedType`. It does not infer the selected model's state from an
unrelated named bucket.

Before the local call, an exhausted snapshot skips directly to fallback. A
missing, malformed, timed-out, or error response is not quota evidence, so the
local call proceeds. Once a local turn starts, any failure remains a Local Codex
failure; the worker does not reinterpret it through error text or a later quota
snapshot.

No transcript is sent to app-server. The probe uses the same minimal Codex
environment as the local summary process, has a finite timeout, and terminates
its process group.

### Fallback orchestration

The summary loop starts with `actualProvider=local-codex`. A positive structured
preflight switches the actual provider to `azure-openai`; all local execution
errors follow the existing summary-failure path.

Before the Azure request, the worker asks the control plane to atomically insert
a job-scoped fallback reservation under the active summary lease. The database
primary key rejects any later reservation after a crash, callback failure, lease
expiry, or reclaim. The first Azure request-audit start atomically binds its
request ID to that reservation; an unreserved or different request ID is
rejected before provider contact. A rejected reservation fails without
contacting Azure.

Azure endpoint/key configuration is optional at process startup so Local Codex
still runs without it. An incomplete pair is treated as unavailable. If Codex
quota is exhausted and a complete valid Azure pair is unavailable, the job
fails explicitly without reserving or making an Azure request.

### Billing and callback trust boundary

Summary terminal events may carry an `actualProvider`. The control plane accepts
only `local-codex` or `azure-openai`. An Azure actual provider requires the
summary lease token; successful Azure output requires complete token usage.
Usage settlement prices and stores the event's actual provider rather than the
job's primary provider. Local events never write Azure usage.

An Azure request error after durable audit start with unavailable token counts
still reports one provider request as unmetered instead of fabricating zero-cost
usage. A failure before durable request start omits Azure attribution and usage;
the reservation remains the audit evidence. The Azure transport does not retry,
and the durable reservation permits at most one paid request for the job across
worker reclaims.

## Risks / Trade-offs

- Quota can deplete after preflight. That local attempt fails rather than being
  reinterpreted as quota exhaustion, which prevents an unrelated failure from
  authorizing Azure spend.
- A hard process or host failure after the Azure request starts but before its
  terminal callback can leave a durable reservation without trustworthy token
  usage. The reservation prevents duplicate spend and preserves audit evidence,
  but that narrow window requires operator reconciliation and cannot be claimed
  as fully settled without provider idempotency or a provider-side request log.
- Starting app-server per job adds a small fixed latency. A persistent daemon is
  unnecessary at the current single-summary concurrency and can be added only
  if measured startup cost matters.
- Production cannot force the real quota-exhausted branch without either
  consuming allowance or bypassing the safety condition. Deployment therefore
  verifies the live Local Codex path and configuration isolation; tests cover
  the structured exhausted state and Azure call count with fakes.

## Rollout

1. Verify the existing Azure summary endpoint/key names are present without
   reading or printing their values.
2. Deploy the summary worker and control plane with Local Codex still selected.
3. Verify current Codex rate-limit status is readable, the live local summary
   path succeeds, and no Azure usage row is written for it.
4. Do not trigger a paid Azure request solely for rollout verification.

Rollback removes the fallback wiring and actual-provider callback field while
leaving historical Azure ledger entries intact.
