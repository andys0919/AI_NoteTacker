## Context

The operator dashboard is a framework-free page that renders job cards from a
lightweight list response and fetches full artifacts on demand. The content
contract is already sufficient; the problem is the long-form reading
experience after detail retrieval.

## Goals / Non-Goals

**Goals:**
- Give summary and transcript distinct, scan-friendly reading modes.
- Match the useful information architecture of the PLAUD reference without
  copying its code, branding, content, or unsupported placeholders.
- Keep the reader usable from 390px mobile through desktop with semantic tabs,
  headings, navigation, and visible focus.
- Reuse current artifacts and the existing static frontend.

**Non-Goals:**
- Add audio playback without an existing authenticated media-playback contract.
- Delete the dormant diarization implementation or migrate historical speaker
  metadata.
- Introduce a router, frontend framework, component library, or scroll-spy.

## Decisions

1. **Use native buttons and hidden panels for artifact tabs.** A small tab
   controller updates `aria-selected`, `tabindex`, and `hidden`; no routing or
   state library is needed.
2. **Do not render full list previews.** The existing `查看內容` action remains
   the explicit boundary that fetches and displays full artifacts, preventing
   long raw Markdown previews from dominating archive cards. PostgreSQL list
   and archive-search queries project only lightweight metadata, denormalized
   previews, and presence flags; search predicates may inspect stored content
   inside PostgreSQL but do not return the artifact JSON to Node.js.
3. **Render summaries as one article, not nested cards.** Heading hierarchy,
   restrained separators, bounded line length, and an available-section table
   of contents provide the PLAUD-like reading model while preserving the
   product's existing visual identity.
4. **Keep transcript scrolling contained.** Long transcripts retain one named,
   keyboard-focusable scroll region so the archive page itself does not become
   tens of thousands of pixels tall.
5. **Do not present stored speaker classification.** The renderer omits the
   speaker field and strips only an identical leading speaker prefix from the
   wording. Historical stored evidence otherwise remains unchanged.

## Risks / Trade-offs

- **Historical summaries lack topic titles** → render their non-empty flat
  sections with the same article hierarchy and build navigation from the
  sections that actually exist.
- **Tabs hide one artifact at a time** → both tabs remain explicit, keyboard
  accessible, and the default selects summary when available or transcript
  otherwise.
- **Archive search still needs artifact wording** → evaluate the content match
  in the repository and return only the matching lightweight list rows.
- **An inner transcript scroll region adds nested scrolling** → it is used only
  after explicit detail loading, is visibly bounded, named, focusable, and
  overscroll-contained.

## Migration Plan

Deploy the revised static assets with the existing control-plane image. No data
or API migration is required. Rollback is a source revert of the frontend
assets and focused tests.

## Open Questions

None.
