## Context

The production dashboard currently runs with operator authentication disabled.
The browser creates a high-entropy local submitter identifier, and operator APIs
return a job only when its stored `submitterId` matches the resolved request
owner. The existing `?jobId=` link therefore identifies a card but does not
grant a different browser access.

Full transcript and summary artifacts already have an explicit owner-scoped
detail API. This change reuses that canonical data while introducing a
separate, narrow public projection. A public response must never reuse the full
operator DTO and then rely on CSS or client JavaScript to hide sensitive fields.

The frontend remains framework-free HTML, CSS, and JavaScript. The new pages
preserve the existing lightweight archive-list boundary. The later approved
`remove-unused-runtime-scaffolding` change makes the browser dashboard
guest-only and removes its unused OTP client; backend owner endpoints still
accept the existing Supabase-backed resolver for bearer-authenticated API
clients, but a future browser sign-in surface requires its own approved change.

## Goals / Non-Goals

**Goals:**

- Give every owned job a stable, complete page that can open in a separate tab.
- Let an owner explicitly create and revoke one no-login share URL for eligible
  completed content.
- Make leaked or stale links time-bounded and independently rotatable.
- Serve only an allowlisted, user-readable public data projection.
- Apply a monochrome layered dark, high-contrast visual system without adding a
  frontend dependency.
- Show operators one aggregate meeting cost while preserving detailed usage
  costs in the admin console.
- Keep long summaries and transcripts readable and responsive from 390px
  through desktop.

**Non-Goals:**

- Recipient accounts, per-recipient permissions, comments, editing, or approval
  workflows.
- Multiple simultaneously active links for one job or configurable expiry
  periods.
- Public raw recording/video playback or artifact downloads.
- Public Markdown, JSON, TXT, or SRT export buttons.
- View analytics, read receipts, or a link-access audit log.
- Search-engine discovery, social preview crawling, or third-party analytics.
- Replacing the existing operator identity system in this change.
- Changing transcript, summary, speaker, pricing, or worker behavior.

## Decisions

### 1. Use separate owner and public reading routes

| Surface | Route | Authorization | Purpose |
|---|---|---|---|
| Owner detail | `/notes/:jobId` | Existing operator owner resolver | Complete status, metadata, actions, summary, and transcript for every job state |
| Public share | `/share#<token>` | Bearer share token | Sanitized, read-only completed meeting content |
| Public data | `/api/shared-meeting` | Token in `Authorization: Bearer` | Return the allowlisted public projection |

Each archive card uses one primary anchor labelled `開啟完整內容（新分頁）`
with `target="_blank"` and `rel="noopener"`. The dashboard does not fetch or
expand summary/transcript artifacts inside the card. The whole card does not
become an implicit click target because its download and destructive actions
remain independent controls. The existing `/?jobId=` owner deep link remains
compatible and may direct the owner to `/notes/:jobId`; it never becomes a
public authorization mechanism.

The owner page fetches heavy artifacts only for its one job. Archive listing and
polling remain lightweight.

### 2. Use a monochrome layered dark semantic color system

The console uses a near-black canvas, three clearly separated charcoal surface
levels, bright neutral text, and white primary actions. Decorative icons,
buttons, focus treatment, progress, and atmospheric light stay within the
black, charcoal, gray, and white scale; chromatic color is reserved for
destructive-error semantics. Content
hierarchy comes from a small bento-style spatial scale, visible translucent
borders, and two reusable elevations; the meeting readers use a quieter dark
editorial treatment so long content remains the focus. The canvas is not flat
`#000000`, avoiding the rejected control-panel appearance and OLED smearing:

| Token | Value | Use |
|---|---|---|
| `--background` | `#050505` | Body and page canvas |
| `--surface` | `#111111` | Primary panels and reading paper |
| `--surface-strong` | `#181818` | Nested or selected content |
| `--surface-raised` | `#212121` | Modals and elevated controls |
| `--border` | `#333333` | Boundaries and dividers |
| `--text` | `#f5f5f5` | Primary text |
| `--muted` | `#a3a3a3` | Secondary text |
| `--link` | `#ffffff` | Links and selected states |
| `--action` | `#f5f5f5` | Primary action background |
| `--action-text` | `#050505` | Primary action text |
| `--danger` | `#fb7185` | Destructive text and borders |

Normal text and controls maintain at least 4.5:1 contrast. Focus indicators are
visible without relying on color alone, primary touch targets remain at least
44 by 44 CSS pixels, and scripted motion respects
`prefers-reduced-motion`. Summary prose is bounded to roughly 65–75 characters
per line with a base size of at least 16px and a line height of at least 1.5.

No new font, icon, or animation dependency is introduced. The public share page
uses a system font stack and first-party assets only.

### 3. Use a reconstructable signed bearer token without storing the credential

`MEETING_SHARE_SECRET` is a dedicated high-entropy server secret of at least
32 UTF-8 bytes. Sharing is disabled and owner share-management requests fail
closed when it is absent or shorter than that minimum.
The internal service token, admin password, or operator identity token is never
reused for this purpose.

Each link has a random `shareId` with at least 128 bits of entropy. The bearer
token has a versioned form derived from:

`HMAC-SHA256(secret, version + shareId + jobId + expiresAt)`

The database stores the random identifier and lifecycle metadata, not the HMAC
signature. The server can reconstruct the same valid token for an existing
link, satisfying the copy-existing-link contract without storing a raw bearer
credential. Verification uses constant-time comparison. Rotating
`MEETING_SHARE_SECRET` invalidates all links as an emergency recovery measure.

The copied URL uses a fragment:

`https://host/share#v1.<shareId>.<signature>`

Fragments are not sent in the initial HTTP request or ordinary `Referer`
headers. First-party share-page JavaScript reads the fragment and sends the
token only in the public API authorization header. Tokens are not placed in API
paths, query strings, logs, analytics, or DOM text.

### 4. Store one share lifecycle row per job

An additive `meeting_share_links` table stores:

- `job_id` as the primary/unique job association
- unique random `share_id`
- `created_at`
- fixed `expires_at`
- nullable `revoked_at`

Creating a link for an eligible job returns the current link when its row is
unrevoked and unexpired. Explicit rotation atomically replaces `share_id`,
`created_at`, and `expires_at`, making the previous credential invalid before
the new one is returned. Revocation sets `revoked_at`.

Expiry is exactly 30 days from creation. A new link may be created after expiry
or revocation. Time is injectable in tests.

### 5. Keep link management owner-scoped and idempotent where practical

Owner endpoints use the existing owner resolver and return `404` for a job not
owned by that requester:

- `POST /api/operator/jobs/:id/share` creates or returns the current valid link.
- `POST /api/operator/jobs/:id/share/rotate` invalidates the old link and
  returns a new one.
- `DELETE /api/operator/jobs/:id/share` revokes the current link.

Create/copy controls disable duplicate submission while pending. Rotation is a
separate, clearly destructive action with confirmation.

Only a `completed` job with a transcript or summary is eligible. Owner detail
pages remain available for queued, active, failed, and completed jobs, but
ineligible pages do not offer public sharing.

### 6. Resolve public content through a server-side allowlist

The public API resolves the share record, verifies the credential and expiry,
and confirms the underlying job is still completed and not operator-hidden.
It then builds a dedicated public DTO containing only:

- a safe display title
- meeting date and duration
- allowlisted fields from the current structured summary, without the complete
  rendered text or `analysisNotes`
- sanitized summary text only for historical artifacts that have no structured
  summary payload
- current canonical readable transcript segments
- timestamps and transcript wording with stored speaker metadata and leading
  anonymous speaker codes omitted as in the owner reader

It excludes:

- job ID, submitter ID/email, meeting URL, passcode, and uploaded source filename
- provider, model, worker, lease, quota, price, and cost fields
- processing history, failures, internal messages, and notification metadata
- recording/upload artifacts and download URLs
- `rawText`, review flags, recognition evidence, and internal transcript fields

The public DTO is constructed on the server. The browser never receives a full
operator/admin DTO from a public endpoint.

The legacy `GET /recording-jobs/:id` response remains available only to trusted
workers. It requires the internal service credential before looking up a job;
the Python worker sends that credential on reads just as it does on claims,
heartbeats, and callbacks. Canonical Compose must require an explicitly
configured internal token and must not accept the documented placeholder
`internal-token`. A browser that knows a job ID therefore cannot use the raw
worker DTO as an alternate sharing endpoint.

The page reads current canonical artifacts on every request. It does not persist
a share snapshot, so later corrections appear immediately.

### 7. Make deletion, hiding, revocation, and expiry fail closed

Public resolution checks both the link row and the current job visibility.
Deleting or clearing a terminal record makes the public page unavailable even
if a separate revocation write is delayed or fails. Owner deletion paths also
revoke the row in the same repository operation as hiding the job, avoiding a
router-level full-artifact pre-read and per-job cleanup fan-out.

Invalid, malformed, expired, revoked, rotated, hidden, deleted, and nonexistent
links all return the same generic unavailable response. The public endpoint
does not reveal which condition occurred.

### 8. Keep the public reader read-only and privacy-safe

The public page provides semantic headings, summary navigation, full readable
transcript content, text selection, and native browser printing. It exposes no
mutation, regeneration, job-control, export, or raw-media action.

Public HTML and API responses use:

- `Cache-Control: private, no-store`
- `Referrer-Policy: no-referrer`
- `X-Robots-Tag: noindex, nofollow, noarchive`
- a restrictive same-origin Content Security Policy
- no third-party fonts, scripts, images, analytics, or embeds

The page includes visible unavailable/loading states, a skip link, sequential
heading structure, keyboard-visible focus, and no page-level horizontal
overflow at 390px.

### 9. Keep operator cost presentation simple

Dashboard cards and owner detail pages show at most one `總費用` item. They do
not repeat transcription, punctuation, or summary subtotals. If part of the
usage is not priced, the aggregate retains the existing unpriced warning
instead of presenting the known subtotal as complete.

The admin usage console remains the place for stage-level cost detail.

### 10. Fail closed at every canonical runtime boundary

The exported application factory and canonical server both require a dedicated
internal service credential of at least 32 UTF-8 bytes. The canonical server
also validates the dedicated admin-console password before opening persistence
or starting scheduled work;
there is no built-in production password; passwords shorter than 6 UTF-8 bytes
and the former documented default are rejected. Tests inject
named test-only values instead of depending on a production fallback.

Canonical Compose requires explicit PostgreSQL and MinIO credentials, reuses
the configured MinIO credentials for the ScreenApp uploader and bucket setup,
and does not publish PostgreSQL or MinIO ports on the host. These backing
services remain reachable by containers on the private Compose network.

## Risks / Trade-offs

- **A recipient can forward a bearer URL** → state this plainly in owner UI;
  provide fixed expiry, immediate revoke, and rotation. Per-recipient identity
  is intentionally outside the first version.
- **The current production owner is browser-local rather than authenticated** →
  reuse the existing high-entropy owner boundary without weakening it; backend
  API clients may use verified identity, while the current browser surface
  remains explicitly guest-only.
- **A share secret rotation invalidates every link** → treat this as an
  intentional emergency-recovery mechanism and document it in deployment
  configuration.
- **Current canonical content can change after sharing** → show the latest
  correction by design; use revocation when the owner needs to freeze access.
- **Dark surfaces can collapse into one flat layer** → use three semantic
  charcoal levels, white actions, restrained monochrome atmospheric gradients,
  visible borders, and quiet editorial reading surfaces rather than glow on
  every card.
- **A fragment token requires JavaScript** → the static page provides a clear
  no-script message; the token remains out of request paths and referrers.

## Migration Plan

1. Add the share-link table and repository without modifying existing job rows.
2. Add the dedicated share secret and keep sharing disabled when it is absent.
3. Add token/lifecycle tests before enabling owner management endpoints.
4. Add the sanitized public DTO and security headers before the public page.
5. Add owner detail routes and share controls while preserving existing
   dashboard deep links.
6. Apply the shared monochrome layered dark tokens and visually verify all four console
   surfaces at 390px, 768px, 1024px, and 1440px.

Rollback removes the routes and controls and leaves the additive share table
inert. Revoking or rotating the share secret immediately disables existing
links without deleting meeting artifacts.

## Open Questions

None. Remaining product choices use the recommended defaults authorized during
the grilling interview.
