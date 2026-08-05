## Context

The owner and public readers already share one dependency-free renderer, but
the first implementation used array positions as anchors and let every public
share request commit after it resolved. A title correction or reordered topic
could therefore make an old URL point at different content, while a slow
response for an old bearer token could overwrite a newer meeting.

The current product contract also excludes historical speaker classification
from normal reading surfaces. That boundary applies to the public DTO as well
as rendered owner/public markup.

## Decisions

### Semantic anchors without persistence

Fixed sections use fixed keys. Topic, subtopic, and grouped follow-up anchors use
a normalized title slug plus a deterministic hash of normalized semantic
content. Reordering preserves the ID, same-title items with different content
remain distinct, and changing their meaning produces a missing old target
instead of silently assigning that URL to another item.

Byte-identical duplicates receive a render-order suffix because they have no
observable semantic distinction. Persisted artifact IDs are deferred until
source records expose an identity that must survive content edits.

### Latest public request wins

Each public load increments one in-memory generation. A response may update the
page only when its generation is still current. Starting a load also rewrites
the existing skip link immediately, before the first network wait, so keyboard
navigation cannot replace the bearer fragment with a bare target. The renderer
reads the current same-token target after the response, so navigation selected
while content is hidden receives focus once the target exists.

No token is moved to a path, query string, body text, or ordinary referrer.

### Native focus and layout behavior

Every link target has `tabindex="-1"`. After scrolling, the reader calls native
`focus({ preventScroll: true })`, giving keyboard and assistive-technology users
the same destination as sighted users.

The detail page removes only the two ancestor overflow clips that blocked CSS
sticky positioning. The table of contents uses native page scrolling with no
independent scroll region, while the existing native `details` navigation
remains the responsive control and follows the 920px media-query transition.

The dedicated owner page uses the structured meeting title as its visible `h1`,
continues summary content at `h2`, and places one collapsed native `details`
control for job metadata and management actions immediately before the reader.
The dashboard list keeps its existing card layout.

### No-speaker public contract

Stored speaker metadata may still be used to strip a duplicated prefix from
transcript text, but it is not returned in the public DTO and is not rendered
as a label. No artifact migration or provider request is required.

## Non-goals

- Persisting anchor IDs in the database.
- Bulk or automatic rewriting of existing summary artifacts.
- Adding a frontend framework, router, or browser-test dependency.
- Changing share-token lifetime, signing, revocation, or access control.
