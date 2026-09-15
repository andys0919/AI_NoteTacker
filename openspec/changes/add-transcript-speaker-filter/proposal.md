# Change: Filter The Transcript By Speaker, And Read Owned Notes In The Same Layout

## Why

Speaker labels now come from a whole-recording diarization pass, so a 67-minute
meeting reads as seven distinct voices. Following one of them still means
scrolling 853 segments and skipping everyone else, and the reader offers no way
to ask "what did this person say".

Separately, the owner note page (`/notes/:id`) and the admin result page
(`/admin/result?jobId=`) render the identical reader but do not read the same.
The owner page nests the reader inside `.job-card`, whose `overflow: hidden` is
not neutralised by the detail-page overrides. A clipping ancestor makes the
summary column's `position: sticky` stick to the card instead of the viewport,
so scrolling the transcript leaves the reader showing one column. An operator
who opens a note from the dashboard sees half the reader the admin page shows.

## What Changes

- Add a speaker filter above the transcript list: an `全部` chip plus one chip
  per speaker, each showing that voice's segment count and carrying the same
  tone as its chips in the transcript.
- Selecting a speaker hides every turn belonging to the others; selecting `全部`
  restores them. Filtering is a view state only: exports, copies, stored
  artifacts and speaker edits are untouched.
- Announce the visible count as a complete sentence so assistive technology
  reports what changed rather than a bare number.
- Keep the selected filter across the re-render that follows a speaker rename or
  reassignment, the same way the open tab and scroll position are already kept.
- Show no filter when a transcript has fewer than two speakers or carries the
  legacy no-speaker shape.
- Stop `.job-card` clipping the reader on the owner note page so the split
  layout, sticky summary column and scrolling behave exactly as they do on the
  admin result page.
- Serve the owner note from the same document the admin result page uses, in an
  owner mode that authenticates with the operator's own identity against the
  operator routes. The back action is the only visible difference, the
  job-information-and-sharing block is gone from the note, and a note whose job
  is still processing says so. The reader's split-layout styles collapse onto
  one class the reader itself carries, so the two pages cannot drift apart.

## Impact

- Tracking ticket: `andys0919/AI_NoteTacker#11`
- Affected specs:
  - `operator-dashboard`
- Affected code:
  - `apps/control-plane/public/artifact-reader.js`
  - `apps/control-plane/public/share.js`
  - `apps/control-plane/public/styles.css`
  - `apps/control-plane/src/app.ts`
  - `apps/control-plane/test/artifact-reader.test.ts`
  - `apps/control-plane/test/meeting-share-shell.test.ts`
- Not affected: transcript artifacts, export routes, speaker edit APIs, the
  public share page's read-only contract.
