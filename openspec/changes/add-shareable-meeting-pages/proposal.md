# Change: Add Shareable Meeting Pages

## Why

The dashboard currently expands complete artifacts inside archive cards, and
its `?jobId=` deep link only locates a job already visible to the same
owner/browser identity. It does not provide a complete standalone reading page
or authorize another person to view a meeting.

Operators need each record to open as a complete page in a separate browser
tab, and they need an explicit way to create a revocable URL that lets another
person read the approved meeting content without signing in. The console and
new reading pages also need one contemporary, high-contrast visual system that
makes the archive and meeting content feel current and easy to scan.

## What Changes

- Replace the light console treatment with a premium monochrome layered-black workspace
  across the operator dashboard and admin console, plus a dark editorial
  reading treatment for owner detail and public share pages. This does not
  restore the previously rejected flat pure-black treatment.
- Collapse operator meeting cards to one `總費用` field while keeping
  stage-level cost detail in the admin console.
- Add an owner-scoped `/notes/:jobId` page for every job state and open it from
  each archive record with a normal new-tab link.
- Remove archive-card summary/transcript expansion so the main dashboard keeps
  only lightweight metadata and a single new-tab content action.
- Add owner controls that create, copy, rotate, and revoke one share link for
  an eligible completed job.
- Add a no-login, read-only `/share#<token>` page backed by a sanitized public
  meeting projection.
- Make each share link valid for 30 days, automatically invalidate it when the
  job is hidden or deleted, and let rotation invalidate the previous link.
- Render current canonical summary and transcript content instead of creating a
  copied snapshot.
- Keep source links, submitter identity, costs, provider/worker metadata,
  internal history, raw media, raw recognition text, and review evidence out of
  every public response.
- Close the legacy raw recording-job lookup as an alternate browser-readable
  artifact path by requiring a non-placeholder internal service credential.
- Make every control-plane entrypoint fail closed when the internal service or
  admin-console credential is missing, without a built-in admin password.
- Keep PostgreSQL and MinIO on the private Compose network and require explicit
  backing-service credentials shared by their canonical consumers.
- Add cache, indexing, referrer, credential-storage, and fail-closed secret
  controls appropriate for bearer-link access.

## Confirmed Product Contract

- A person who possesses the secret URL may read the shared page without
  signing in.
- Only completed jobs with at least a transcript or summary can be shared.
- A job has at most one active share link.
- A valid existing link is reused; explicit rotation creates a new link and
  invalidates the old one.
- Links expire after 30 days and may be revoked earlier.
- Public viewers can select/copy text and use native browser printing, but
  cannot edit, control jobs, regenerate content, or download raw media.

## Impact

- Tracking ticket: `andys0919/AI_NoteTacker#6`
- Affected specs:
  - `operator-dashboard`
  - new capability `meeting-content-sharing`
  - `internal-service-security`
  - `deployment-readiness`
- Affected code:
  - control-plane public routes and static HTML/CSS/JavaScript
  - owner job-detail and share-management APIs
  - sanitized public meeting API
  - recording-job/share-link persistence
  - environment configuration and focused tests
- Data impact:
  - additive `meeting_share_links` persistence
- Security impact:
  - a new bearer-link boundary with a dedicated signing secret
  - fail-closed internal/admin credentials and private backing-service ports
- No frontend framework, animation library, or third-party sharing service is
  added.
- This proposal supersedes the light-palette decision in
  `refine-console-ui-ux` with the user's approved monochrome dark direction; its
  content hierarchy, responsive, and accessibility contracts remain.
- The owner-only deep link from `add-operator-productivity-workflows` remains
  private; the new public link is a separate token-authorized route.
- The approved work includes local implementation and verification. Deployment,
  commit, push, release, archive, and pull request actions remain separately
  authorized operations.
