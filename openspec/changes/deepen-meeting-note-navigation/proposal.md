# Change: Deepen Meeting Note Navigation

## Why

Structured summaries already contain sections, topics, and subtopics, but the
reader table of contents links only top-level sections. Long notes therefore
hide their useful hierarchy and cannot link directly to a specific topic or
subtopic. The public share page also keeps its bearer token in the URL fragment,
so a normal `#section-id` link would replace the credential and break access.

## What Changes

- Render owner and public structured summaries through one shared,
  dependency-free renderer.
- Add stable nested links for every visible section, topic, subtopic, and
  grouped follow-up.
- Derive topic and subtopic anchors from their normalized titles and semantic
  content so same-title items remain distinct and reordering does not silently
  retarget an existing URL.
- Preserve the public bearer token while adding an optional deep target to the
  same fragment as `#<token>::<target-id>`.
- Restore the requested deep target after asynchronous owner or public content
  rendering and move keyboard focus to that target.
- Keep the public skip link token-safe while content is loading and ignore
  out-of-order responses after the fragment changes to another share token.
- Keep historical speaker metadata out of both the rendered transcript and the
  public meeting DTO, consistent with the current no-speaker reader contract.
- Keep the owner table of contents sticky on long pages and use the meeting
  title or source filename as the browser-tab title.
- Make the dedicated owner page use the meeting title as its visible page
  heading, collapse operational metadata into one compact control before the
  artifact reader, and keep controls keyboard accessible.
- Tighten future summary guidance so supported prerequisites, normal flow,
  exceptions, recovery, ownership, outcomes, and cross-topic dependencies stay
  connected in the topic hierarchy.

## Impact

- Affected specs:
  - `operator-dashboard`
  - `meeting-content-sharing`
  - `meeting-summary-generation`
- Affected code:
  - shared browser artifact renderer and focused frontend tests
  - owner/public reader JavaScript and CSS
  - public meeting DTO allowlist
  - shared summary prompt and focused prompt test
- No summary schema, database migration, frontend dependency, bulk or automatic
  historical artifact rewrite, commit, push, or release is included. One
  user-approved reference summary regeneration is retained as acceptance
  evidence.
