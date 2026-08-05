## 1. Specification and ticket

- [x] 1.1 Create tracking issue `andys0919/AI_NoteTacker#5` for the PLAUD-inspired artifact reader and generic summary structure.
- [x] 1.2 Strictly validate this OpenSpec proposal, design, tasks, and operator-dashboard delta.

## 2. Long-form artifact reader

- [x] 2.1 Replace combined summary/transcript expansion with accessible tabs that show one artifact at a time.
- [x] 2.2 Render summaries as a bounded-width article with available-section navigation and historical-artifact compatibility.
- [x] 2.3 Render timestamp and transcript wording as separate visual fields without raw-recognition or speaker classification.
- [x] 2.4 Remove full raw Markdown summary previews from lightweight archive cards.

## 3. Responsive UI/UX

- [x] 3.1 Refine hierarchy, spacing, line length, focus, tab state, and long-content scrolling without a new dependency.
- [x] 3.2 Verify desktop and 390px mobile layouts have no clipping or page-level horizontal overflow.

## 4. Verification and review

- [x] 4.1 Update focused frontend regressions for tabs, summary navigation, historical summaries, and transcript fields.
- [x] 4.2 Run affected tests, the control-plane build, strict OpenSpec validation, and `git diff --check`.
- [ ] 4.3 Rebuild/recreate the control plane and inspect the live desktop and mobile reader with Chrome.
- [x] 4.4 Run separate Standards and Spec reviews against the working-tree diff and resolve actionable findings.
- [x] 4.5 Exclude recording, transcript, and summary artifact JSON from PostgreSQL operator list/search projections while preserving preview, presence, search, cursor, and in-memory parity regressions.
- [x] 4.6 Backfill historical list previews idempotently and exclude active lease credentials from list types and projections, with focused migration and list regressions.

## 5. Speaker-free production

- [x] 5.1 Stop the canonical Compose deployment from injecting diarization credentials.
- [x] 5.2 Omit stored speaker classification from summary prompts, readers, admin transcripts, and text exports.
- [ ] 5.3 Run focused regressions, rebuild/recreate affected services, and verify the live reader.
- [x] 5.4 Strip historical leading anonymous speaker codes even when speaker
  metadata is absent, with a focused reader regression.
