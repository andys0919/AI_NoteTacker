# Change: Refine Console UI and UX

## Why
The operator dashboard and admin console contain redundant summary/navigation surfaces, dormant frontend styles and guest-auth branches, and narrow-screen layouts that do not reliably collapse into a focused workflow. The dark decorative treatment and repeated bilingual labels also compete with the meeting content operators are trying to read.

## What Changes
- Adopt a minimal, content-first monochrome workspace with flat neutral surfaces and a restrained high-contrast accent across the operator and admin pages.
- Remove decorative background layers, repeated English eyebrow labels, duplicate status copy, and actions that have no current result to act on.
- Remove dashboard identity/default-name summary cards that duplicate fixed guest-mode or form information.
- Replace duplicated admin overview/navigation surfaces with one compact section navigation.
- Remove CSS selectors and JavaScript branches with no active DOM, interaction, or verification owner.
- Add semantic filter/loading state, visible keyboard focus, practical touch targets, contained table scrolling, and reduced-motion-safe feedback.
- Establish a repeatable browser benchmark for console boot readiness, then remove serial waits between independent initial requests and record before/after medians under the same fixed latency.
- Preload each page's required native modules, defer off-screen panel rendering with reserved intrinsic space, and keep the default admin history view to the latest 100 records while retaining explicit larger limits.
- Use one restrained native motion rhythm for meaningful page, panel, list, status, tab, login/workspace, shared-reader, and dialog entry/exit transitions without animating large tables row by row.
- Keep archive quick filters usable across paginated results, including when the current page has no matching job.
- Remove the optional recognition-glossary control from recording intake while retaining backend compatibility for existing jobs and API clients.
- Refresh active job progress in place without repainting the full job list, and omit unsettled zero-value cost rows.
- Load full transcripts only when requested and display them in one compact
  reader with separate timestamp and wording fields while hiding raw-recognition
  evidence. The later `refine-meeting-artifact-reader` change supersedes this
  change's former speaker-context presentation: normal readers omit stored
  speaker classification.
- Preserve existing meeting, upload, archive, governance, authentication, quota, pricing, stored transcript evidence, export, and summary behavior.
- The later approved `remove-unused-runtime-scaffolding` change supersedes the
  dormant browser OTP branches; backend operator authentication remains intact
  while the maintained dashboard stays guest-only.

## Impact
- Tracking ticket: `andys0919/AI_NoteTacker#2`
- Final all-surface acceptance ticket: `andys0919/AI_NoteTacker#6`
- Affected specs: `operator-dashboard`
- Affected code: `apps/control-plane/public/` console HTML/CSS/JavaScript, a repeatable console benchmark, the lightweight operator list serializer, and focused API/shell/UX tests
- No database or API contract change, new frontend framework, dependency, commit, push, release, archive, or pull request is included
- A follow-up authorization includes rebuilding and recreating only the production `control-plane` service after verification
