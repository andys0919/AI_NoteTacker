## 1. Contract

- [x] 1.1 Specify nested owner/public summary links, token-preserving public
  deep links, and evidence-faithful topic relationships.
- [x] 1.2 Strictly validate this change.

## 2. Shared summary reader

- [x] 2.1 Move structured-summary markup into the existing shared artifact
  renderer and reuse it on owner and public pages.
- [x] 2.2 Give each visible section, topic, and subtopic a stable nested link.
- [x] 2.3 Preserve and parse the public bearer token while navigating to an
  optional deep target.
- [x] 2.4 Keep the nested navigation responsive, keyboard accessible, and
  readable on the pure-black visual system.

## 3. Summary guidance

- [x] 3.1 Keep supported process order and cross-topic dependencies explicit
  without adding a new schema field or model request.

## 4. Verification and deployment

- [x] 4.1 Run the focused browser-renderer, page-shell, and summary-prompt tests,
  affected builds, strict OpenSpec validation, and `git diff --check`.
- [x] 4.2 Rebuild/recreate the affected services and verify live owner desktop
  and mobile deep-link behavior.

## 5. Review remediation

- [x] 5.1 Reject stale public-share responses and preserve token-aware skip
  navigation before the first API response.
- [x] 5.2 Replace position anchors with semantic anchors and focus every
  restored section, topic, or subtopic.
- [x] 5.3 Remove speaker metadata from public DTOs and owner/public transcript
  markup while retaining stored-prefix cleanup.
- [x] 5.4 Restore long-page sticky navigation, responsive disclosure behavior,
  readable third-level links, and meeting-specific document titles.
- [x] 5.5 Add observable regression coverage for request ordering, loading
  navigation, semantic anchor reordering, focusability, and the no-speaker DTO.
- [x] 5.6 Create one real share, verify it from a recipient context at an exact
  nested URL, revoke it, and verify the revoked token is unavailable.

## 6. Content-first remediation

- [x] 6.1 Add stable grouped follow-up targets to the shared owner/public
  renderer and nested table of contents.
- [x] 6.2 Use the meeting title as the dedicated owner page heading and place
  collapsed job metadata and management actions immediately before the reader.
- [x] 6.3 Run focused tests, build, strict OpenSpec validation, deploy, and
  verify desktop/mobile owner deep links.
- [x] 6.4 Regenerate the reference meeting with the deployed summary rules and
  verify the stored artifact and live page.

## 7. Final correctness remediation

- [x] 7.1 Poll active owner detail pages through the full per-job snapshot so
  newly completed artifacts appear without reloading.
- [x] 7.2 Keep desktop summary navigation sticky without a nested scroll region
  and continue the detail-page heading hierarchy from `h1` to `h2`.
- [x] 7.3 Make duplicate-title topic, subtopic, and grouped follow-up anchors
  content-specific and stable across reordering.
- [x] 7.4 Restore the latest same-token public target after an in-flight response
  renders.
- [x] 7.5 Run focused behavioral tests, build, strict change validation, deploy,
  and verify live health and served frontend assets.
- [x] 7.6 Keep nested navigation visible when one top-level section owns
  nested topics, then verify it under acceptance ticket #6.
