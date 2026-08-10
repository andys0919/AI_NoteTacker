## Context

The control plane serves two framework-free console pages from one HTML/CSS/JavaScript surface: the operator dashboard and the authenticated admin console. Their backend contracts and security boundaries are already established, so this change is limited to visual hierarchy, responsive layout, interaction feedback, and deletion of frontend elements with no active owner.

## Goals / Non-Goals

**Goals:**
- Use one minimal, content-first monochrome visual system that keeps meeting notes primary from 390px mobile widths through desktop.
- Use native browser semantics for navigation, forms, focus, status, and contained table scrolling.
- Remove duplicated cards, labels, status copy, decoration, selectors, and branches only when no active DOM or behavior depends on them.

**Non-Goals:**
- Change APIs, authentication, data models, transcript/summary behavior, or runtime infrastructure.
- Introduce a frontend framework, component library, animation library, or new dependency.
- Redesign business workflows beyond their presentation and duplicate-submit protection.

## Decisions

1. **Retain one shared stylesheet and the existing page scripts.** Shared tokens and responsive rules keep the two small static pages consistent without adding a build/runtime layer. Splitting the CSS or adopting a component framework would add ownership and dependency cost without solving a missing capability.
2. **Prefer native HTML and CSS behavior.** Landmarks, anchors, table semantics, form busy state, `aria-live`, `aria-pressed`, visible focus, `:target`, and media queries cover the requirements. A JavaScript router, scroll-spy, or custom widget set would duplicate browser behavior.
3. **Contain intrinsically wide content at its owner.** Page shells collapse at existing responsive breakpoints, while governance tables retain useful column width and scroll inside their wrapper. Shrinking every table column would make operational data unreadable.
4. **Scope asynchronous feedback to the submitted form.** Only the affected submit control is disabled, the form exposes `aria-busy`, and its original state is restored in `finally`. A page-wide lock would unnecessarily block unrelated operations.
5. **Use content hierarchy instead of decorative chrome.** Flat near-black and neutral surfaces, one sans-serif type family, restrained borders, and a high-contrast monochrome interaction accent replace decorative gradients, glows, serif display type, and repeated English eyebrow labels. No image, icon, or component dependency is added.
6. **Delete only proven-unused frontend surfaces.** Literal selectors and branches without a DOM, interaction, or test owner are removed; dynamically composed runtime health classes remain. Empty-history actions remain hidden until there is a terminal record to clear. Broad cleanup outside the console surface is intentionally excluded.
7. **Separate transcript reading from transcript evidence.** The lightweight job
   list signals that content exists, while explicit detail retrieval loads the
   artifact into one keyboard-focusable reader with separate timestamp and
   wording fields. `refine-meeting-artifact-reader` supersedes the earlier
   speaker-context decision: normal readers omit stored speaker classification
   and raw-recognition review evidence while preserving the underlying artifact.
8. **Keep client-side quick filters incremental.** The existing cursor API remains unchanged. Changing a quick filter preserves already loaded pages, and the load-more action remains available when later pages may contain a match.
9. **Measure the real browser critical path before changing it.** A local Chromium benchmark uses the same routes, cache mode, viewport, iteration count, and simulated network latency before and after the implementation. Console readiness is the first stable, usable state after the relevant API data is applied, not merely the document `load` event.
10. **Parallelize only independent boot work.** Operator configuration and job-list requests start together and render after both resolve. Admin pricing reference and session validation start together; the login view does not wait for pricing, while protected governance requests still wait for a valid session. This removes avoidable request waves without weakening authentication or briefly rendering stale currency values.
11. **Prefer native loading and rendering primitives.** `modulepreload` removes module-discovery request waves. `content-visibility: auto` with intrinsic-size reservation skips off-screen rendering without removing content or adding a virtual-list implementation. The admin defaults to the most recent 100 usage entries, while the existing 500/1000/5000 choices remain available on demand.
12. **Animate state, not decoration.** Shared duration/easing tokens drive transform/opacity entry and exit for page surfaces, dynamic list/status changes, tabs, login/workspace switching, shared content, and the native dialog. Large table rows, progress motion, and continuous decorative effects are excluded; reduced-motion collapses all nonessential motion.

## Risks / Trade-offs

- **Static pages can drift from selectors referenced in JavaScript** → focused shell tests and a source reference check guard the shared contract.
- **Wide governance tables require horizontal interaction on small screens** → scrolling stays inside a labeled, overscroll-contained table wrapper instead of widening the page.
- **Removing duplicated context may reduce explanatory text for first-time users** → workflow headings, labels, status regions, and the single admin section navigation retain task-relevant guidance.
- **A contained transcript introduces an inner vertical scroll region** → the region is named, keyboard-focusable, overscroll-contained, and used only after explicit detail loading so long recordings do not dominate the entire page.
- **Motion can distract or conflict with user settings** → feedback is minimal and reduced-motion preferences collapse transitions and animation.
- **Native view transitions and content visibility are not universal** → both are progressive enhancements; unsupported browsers keep the same immediate DOM update and complete content.
- **Animations can increase work on data-heavy pages** → only composite-friendly opacity/transform state changes are animated, and large table rows never receive staggered animation.

## Migration Plan

Ship the static console assets by rebuilding and recreating only the existing production `control-plane` service; no data or API migration is required. Rollback is a rebuild from the prior source state.

## Open Questions

None.
