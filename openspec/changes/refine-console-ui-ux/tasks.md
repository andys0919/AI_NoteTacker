## 1. Specification and ticket
- [x] 1.1 Create GitHub issue `andys0919/AI_NoteTacker#2` for this exact UI/UX change.
- [x] 1.2 Strictly validate the OpenSpec proposal, design, tasks, and operator-dashboard delta.

## 2. Focused console surfaces
- [x] 2.1 Remove redundant operator identity/default-name summary cards and their dead JavaScript paths.
- [x] 2.2 Replace duplicated admin overview/topbar surfaces with one compact, native section navigation.
- [x] 2.3 Remove unreferenced frontend selectors and obsolete guest-auth branches without changing API or security behavior.

## 3. Responsive and accessible UX
- [x] 3.1 Replace decorative layered-console styling with one flat, content-first monochrome visual system without adding a frontend dependency.
- [x] 3.2 Make operator and admin layouts responsive at 390px, 768px, 1024px, and 1440px with no page-level horizontal overflow, prioritizing existing notes before intake on narrow screens.
- [x] 3.3 Keep wide admin tables inside their own scroll container and provide accessible table, filter, focus, and live-status semantics.
- [x] 3.4 Give primary asynchronous form actions visible busy feedback and duplicate-submission protection.
- [x] 3.5 Remove the upload glossary control without deleting backend compatibility.
- [x] 3.6 Poll active jobs and update only their progress/card DOM so unrelated expanded content and scroll state remain intact.
- [x] 3.7 Hide unsettled zero-value costs and retain explicit unpriced-usage labels.
- [x] 3.8 Load complete transcripts on demand and render them as one contained reader without raw-recognition disclosures; its former speaker-context presentation is superseded by `refine-meeting-artifact-reader`.
- [x] 3.9 Remove decorative background layers, repeated bilingual eyebrow labels, duplicate job status copy, and unavailable terminal-history actions.
- [x] 3.10 Add a repeatable Chromium boot-readiness benchmark and capture the unchanged baseline under fixed network latency.
- [x] 3.11 Remove independent serial boot waits, preload required modules, defer off-screen rendering, and default admin history to the latest 100 records without removing larger on-demand limits.
- [x] 3.12 Add one reduced-motion-safe native motion system for meaningful page, panel, list, status, tab, login/workspace, shared-reader, and dialog entry/exit transitions.

## 4. Verification and review
- [x] 4.1 Update focused shell/UX regression checks for the revised contracts.
- [x] 4.2 Run the affected frontend tests, focused API checks, control-plane build, static dead-reference checks, strict OpenSpec validation, and `git diff --check`.
- [x] 4.3 Render and inspect operator/admin desktop and mobile layouts for hierarchy, clipping, spacing, focus affordances, and consistency.
- [x] 4.4 Review the implementation against repository standards and GitHub issue #2, then resolve all actionable findings.
- [x] 4.5 Rebuild and recreate only the production `control-plane` service, then verify health and live asset delivery.
- [x] 4.6 Reconcile the historical transcript-reader contract with `refine-meeting-artifact-reader` and mark its no-speaker presentation as the current requirement.
- [ ] 4.7 Complete all-surface acceptance ticket #6 with non-misleading loading
  states, 1rem long-form prose, current responsive visual evidence, and a
  control-plane redeploy.
- [x] 4.8 Re-run the identical performance benchmark, report before/after medians and asset sizes, and inspect dashboard, admin, notes, and share surfaces at desktop, 390px, and reduced motion.
