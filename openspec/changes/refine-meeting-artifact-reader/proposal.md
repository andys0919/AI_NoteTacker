# Change: Refine Meeting Artifact Reader

## Why

Loading a completed job currently places the full summary and transcript into
the same expanded job card. A 93-minute recording therefore becomes one long,
mixed reading surface that is hard to scan, especially on mobile. The PLAUD
share page demonstrates a clearer information model: summary and transcript
are separate reading modes, summaries use article hierarchy, and transcript
segments keep timestamp and wording visually distinct.

## What Changes

- Replace the combined summary/transcript expansion with accessible
  `摘要` and `逐字稿` tabs that show one long-form artifact at a time.
- Render summaries as a readable article with overview, content-derived topic
  hierarchy, conclusions, follow-ups, decisions, risks, and unresolved
  questions; omit empty or unsupported sections.
- Add a desktop table of contents for available summary sections and collapse
  it naturally into the article flow on narrow screens.
- Render each transcript segment with separate timestamp and wording while
  omitting raw-recognition review evidence and stored speaker classification.
- Keep list responses lightweight and load complete artifacts only after the
  operator requests them.
- Preserve historical flat summary artifacts, route ownership/authentication,
  stored evidence, pricing state, job progress polling, and the existing
  dependency-free frontend. Operator lists return lightweight job fields, and
  detail requests still return complete artifacts.

## Impact

- Tracking ticket: `andys0919/AI_NoteTacker#5`
- Affected specs:
  - `operator-dashboard`
- Related active change:
  - `improve-uploaded-meeting-note-quality` owns the generic topic-based
    summary prompt and artifact schema.
- Affected code:
  - `apps/control-plane/public/app.js`
  - `apps/control-plane/public/admin.js`
  - `apps/control-plane/public/transcript-review.js`
  - `apps/control-plane/public/styles.css`
  - `apps/control-plane/src/app.ts`
  - `apps/control-plane/src/domain/recording-job-list-item.ts`
  - `apps/control-plane/src/infrastructure/*recording-job-repository.ts`
  - `docker-compose.yml`
  - `workers/transcription-worker/src/transcription_worker/transcript_summary.py`
  - focused frontend tests
- No database migration, frontend framework, new dependency, commit, push,
  release, or pull request is included. The operator list payload intentionally
  omits full artifacts, PostgreSQL list queries do not transfer artifact JSON
  into Node.js, and the existing detail response remains complete.
