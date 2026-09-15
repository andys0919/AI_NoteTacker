## 1. Contract

- [x] 1.1 Review and approve this change.
- [x] 1.2 Validate the change and affected spec deltas strictly.

## 2. Shared result reader

- [x] 2.1 Route public rendering through artifact-reader.js with the owner
  detail layout.
- [x] 2.2 Preserve public summary deep links and responsive behavior.
- [x] 2.3 Add the public header copy-share action using the current share token.

## 3. Public read-only actions

- [x] 3.1 Return resolved speaker display labels in the public allowlist.
- [x] 3.2 Add bearer-authenticated public media playback without token query
  strings.
- [x] 3.3 Add bearer-authenticated public Markdown export from the public
  projection.
- [x] 3.4 Keep editing, job controls, private metadata, and internal evidence
  unavailable to bearer readers.

## 4. Verification and deployment

- [x] 4.1 Add focused API, reader, browser behavior, accessibility, and
  public-security regressions.
- [x] 4.2 Run the affected build and focused tests.
- [x] 4.3 Render owner, admin, and public result pages at desktop and mobile
  widths and inspect clipping, actions, playback, and downloads.
- [x] 4.4 Deploy only after approval and verify the live recipient flow.
