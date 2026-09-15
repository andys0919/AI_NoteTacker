## Context

The owner and admin result pages already use artifact-reader.js. The public page
currently builds summary and transcript sections directly in share.js, which
causes visible layout and action differences.

## Goals / Non-Goals

- Goals: one result-reader structure, one responsive layout, speaker labels in
  the public transcript, authenticated public playback, public Markdown export,
  and a copy-share action in the result header.
- Non-goals: public editing or renaming, job cancellation, raw JSON export,
  provider evidence, cost/lease data, account identity, or a new UI framework.

## Decisions

1. Reuse renderArtifactReader for every meeting result surface. The public
   call uses the same detail layout and read-only options as the owner call.
2. The public DTO includes only resolved speaker display labels and the existing
   readable text/timing fields. It does not include speaker maps, raw fields, or
   provider evidence.
3. Public media and Markdown routes authenticate with the bearer token in the
   Authorization header. The browser fetches media with that header and gives
   playback a temporary Blob URL, so the bearer token stays out of request URLs.
4. Public Markdown is generated from the allowlisted public projection. It
   contains the same reader content and speaker/timestamp presentation without
   owner identity or internal job fields.
5. The public header gets the same copy-share placement and accessible labeling;
   it does not get owner-only editing or lifecycle controls.

## Risks / Trade-offs

- A bearer link becomes permission to hear the recording and download the public
  document; link rotation and revocation remain the recovery controls.
- Blob playback downloads the recording through JavaScript before native audio
  seeking; a range-aware authenticated proxy can be added later if this is
  measured as too slow or memory-heavy.
- Existing public deep-link target IDs must remain stable while switching to the
  shared renderer.
