## Context
The current dashboard already supports authenticated job ownership, archive browsing, export, and terminal email notifications. The missing layer is workflow efficiency for repeated company use: role-based defaults, low-friction archive narrowing, and one-click sharing of outputs. These changes touch both the dashboard and the summary-generation path, because template context should not be purely cosmetic.

## Goals / Non-Goals
- Goals:
  - Reduce repetitive setup for recurring users across departments.
  - Make archive retrieval and sharing materially faster.
  - Reuse the existing email notification system and avoid parallel notification backends.
  - Preserve backward compatibility for jobs created before this change.
- Non-Goals:
  - No admin UI for editing templates yet.
  - No external Slack/Teams/CRM integrations in this change.
  - No multi-user shared archive beyond the existing owner-scoped access rules.

## Decisions
- Decision: Provide a small built-in template catalog from the server config endpoint.
  - Rationale: Keeps presets consistent across browsers without introducing a new admin persistence layer.
- Decision: Persist `submissionTemplateId`, `summaryProfile`, and `preferredExportFormat` on each job.
  - Rationale: Lets completed jobs preserve the workflow context that produced them and supports cross-device archive use.
- Decision: Add browser notifications as an optional client-side channel while leaving email delivery server-driven.
  - Rationale: Email already exists for authenticated operators; browser notifications add immediacy without new infrastructure.
- Decision: Implement archive quick filters client-side after fetching the owner-scoped job list.
  - Rationale: The current per-user job volume is modest enough that client-side slicing keeps the API simpler.
- Decision: Use deep links of the form `?jobId=<id>` and highlight/scroll the matching card after load.
  - Rationale: This reuses the existing single-page dashboard without inventing a new route system.
- Decision: Treat local/cloud runtime behavior as deployment-mode defaults, not hard-coded exclusive paths.
  - Rationale: Operators still need override room, but the default local path should favor GPU Whisper + Codex CLI while cloud defaults should favor Azure OpenAI transcription and `gpt-5.1-mini` summaries.

## Risks / Trade-offs
- Persisting new job preference fields requires schema updates in both in-memory and PostgreSQL repositories.
  - Mitigation: Default all new fields to optional values and validate backward compatibility in tests.
- Browser notifications are permission-gated and can feel inconsistent across environments.
  - Mitigation: Show clear status copy in the dashboard and degrade gracefully when unsupported or denied.
- Summary profile prompts can overfit if they become too prescriptive.
  - Mitigation: Keep profiles lightweight, transcript-faithful, and limited to emphasis rather than new output sections.

## Migration Plan
1. Add optional fields to the recording job domain and persistence schema.
2. Serve built-in templates and notification capabilities from operator config.
3. Update dashboard submission and archive behavior.
4. Update worker prompt handling for profile-aware summaries.
5. Verify that pre-existing jobs without the new fields still render and export correctly.

## Open Questions
- None for this scope; default templates will be built-in presets for General, Sales, Product, and HR.
