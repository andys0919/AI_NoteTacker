# Change: Unify meeting result reader and public share parity

## Why

The owner note page, admin result page, and bearer share page must present one
consistent meeting document. The current public page has a separate rendering
path, so its layout and available reading actions drift from the current owner
reader.

## What Changes

- Make the existing artifact reader the only meeting-result renderer for
  /notes/:id, /admin/result, and /share#token.
- Give the public bearer reader the same tabs, transcript layout, resolved
  speaker labels, recording playback, and Markdown download actions as the
  owner reader.
- Keep the public reader read-only: no speaker edits, job controls, internal
  metadata, raw recognition evidence, cost data, or private identifiers.
- Add the existing share-link copy action to the public result header.
- Keep bearer credentials in the URL fragment and Authorization headers; do
  not put tokens in media/export paths, query strings, logs, or DOM text.

- Ticket: https://github.com/andys0919/AI_NoteTacker/issues/13
## Impact

- Affected capabilities: meeting-content-sharing and operator-dashboard.
- Affected code: shared artifact reader, public meeting projection, public
  media/export routes, owner/public result shell, and focused tests.
- Security change: anyone holding an active share link can play the source
  recording and download the public Markdown projection.
- The workbench and administration forms keep their required operational
  controls, but all meeting result content uses the same reader template.
