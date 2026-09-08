# Review and verification

Ticket: https://github.com/andys0919/AI_NoteTacker/issues/10

Main baseline: `c61f358aafb5029b1a7bc720e75a99eae462fc4a`.
Shared-runtime baseline: `698c883ce79599644e51fbc9270c93fdf711a598`.
Existing HANDOFF/Compose changes and shared `config/` are excluded.

## Standards

Initial review identified three issues: duplicated result-eligibility logic,
a test-only exported projection helper, and missing API documentation. These
were corrected. Both repositories now use the same canonical readability
predicate; the projection is private; and the endpoint contract is documented.
The follow-up and subsequent scoped CSS review report **0 unresolved findings**.
The final scoped reader-lifecycle review also found no unresolved issues after
adding detached process-group cleanup with graceful termination and a bounded
force-kill fallback. Matching leftover quota readers were not found.

## Spec

Initial review identified two issues: PostgreSQL eligibility used a truncated
preview, and an open usage card did not expire its original observation. Both
were corrected with canonical full-content checks, minute refreshes, visibility
refresh, and an expiry timer. The follow-up reports **0 unresolved findings**.

## Verification

- 42 targeted control-plane/API/view-model/reader tests passed.
- 2 targeted PostgreSQL metadata tests passed, including content beyond preview
  boundaries, display text, and speaker-only content.
- 10 summary-worker tests and 1 authenticated central endpoint test passed.
- Both TypeScript checks, scoped shared-runtime Biome checks, browser module
  syntax checks, and strict OpenSpec validation passed.
- Candidate rendering used production PostgreSQL in enforced READ ONLY
  transactions and a temporary loopback-only central HTTP endpoint. The worker
  consumed that endpoint through the real remote reader and reported to an
  isolated control plane. No production jobs were claimed or changed.
- The admin result matched the canonical shared projection of the stored job;
  all 988 transcript segments rendered. Desktop and 390px mobile were inspected,
  including corrected narrow-screen text wrapping and readable header buttons.
- Personal quota, recent governance changes, and today's report and their
  automatic API requests were absent. No public share link was created.

## Remaining live dependency

The official central RPC/new reader returned an available `team` seven-day
window at `2026-09-08T10:12:55Z`. During later full-path verification,
`chatgpt.com` DNS resolution failed on both the host and container. Both
configured upstream resolvers timed out when queried directly. The candidate
correctly showed unavailable, but a fresh **available** full-path readback is
still pending and is explicitly retained as gate G8.

Rendered screenshots and the machine-specific gate ledger are retained locally;
their verification outcomes are summarized above.
The temporary browser cleanup initially raced a Chrome child; cleanup was
recovered, and the final candidate check exited zero.

## Delivery state

Shared runtime endpoint dependency: `claude-telegram-bot` commit
`c0f41f658b1ded5d0a8a68bfc1bce808e3fb52ec` on `main`.

Publication is separate from deployment. No deployment, public share creation,
OAuth duplication, or host network configuration change is included in this
change. Deployment needs the shared runtime, summary worker, and control plane
together; the fresh available allowance readback remains a delivery prerequisite.

The PostgreSQL metadata implementation inspects stored artifacts for exact
readability and returns only metadata to the client. Persisting an eligibility
flag is the documented upgrade path if large archives make those reads costly.
