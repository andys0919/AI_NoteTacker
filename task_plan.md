# Task Plan: Add Cloud Usage Governance OpenSpec Proposal

## Goal
Create and validate an OpenSpec change proposal for cloud-only usage governance covering job policy snapshots, per-user daily quota reservation, split transcription/summary providers, concurrency pools, admin controls, and audit logging.

## Current Phase
Phase 5 complete

## Phases
### Phase 1: Requirements & Discovery
- [x] Understand user intent
- [x] Identify constraints and requirements
- [x] Document findings in findings.md
- **Status:** complete

### Phase 2: Proposal Planning
- [x] Choose change scope and change-id
- [x] Define affected capabilities and spec deltas
- [x] Document architecture decisions with rationale
- **Status:** complete

### Phase 3: Proposal Authoring
- [x] Write proposal.md
- [x] Write design.md
- [x] Write tasks.md
- [x] Write affected spec delta files
- **Status:** complete

### Phase 4: Validation
- [x] Run OpenSpec validation
- [x] Fix any validation issues
- [x] Update planning files with final status
- **Status:** complete

### Phase 5: Delivery
- [x] Review generated proposal files
- [x] Summarize assumptions and outcomes for the user
- **Status:** complete

## Key Questions
1. How should cloud cost governance be scoped for v1 without introducing full RBAC or multi-tenant billing?
2. Which fields must be latched onto jobs at submission time versus claim time to make quota reservation and cost auditing deterministic?
3. How should transcription and summary routing split while preserving existing admin controls and worker contracts?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Limit proposal scope to cloud spend only | User explicitly excluded local cost accounting for now |
| Treat this as a new cross-cutting OpenSpec change instead of direct implementation | Request changes architecture, data model, and admin controls across multiple modules |
| Use change-id `add-cloud-usage-governance` | It cleanly covers quota, usage ledger, routing split, and audit scope in one proposal |
| Introduce a new governance capability plus a new job execution policy capability | Snapshotting and quota accounting are broader than provider switching alone |
| Implement control-plane and worker core first, then wire dashboard | This order fixed the contract before UI consumed it |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| OpenSpec validation rejected two MODIFIED requirements in `whisper-transcription-pipeline/spec.md` because the requirement text was embedded in the heading | 1 | Split each item into a named requirement heading plus a separate requirement text line, then re-ran validation successfully |

## Notes
- Update phase status as progress changes.
- Re-read this plan before major proposal decisions.
- Log validation failures if they occur.
