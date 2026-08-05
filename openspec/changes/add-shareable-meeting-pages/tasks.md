## 1. Contract

- [x] 1.1 Record the approved bearer-link, content, eligibility, expiry,
  lifecycle, canonical-content, and read-only decisions.
- [x] 1.2 Strictly validate the proposal, design, tasks, and all spec deltas.

## 2. Persistence and security

- [x] 2.1 Add failing tests for token signing, constant-time verification,
  fail-closed secret configuration, 30-day expiry, reuse, rotation, and
  revocation.
- [x] 2.2 Add additive one-row-per-job share-link persistence for PostgreSQL and
  the in-memory test repository.
- [x] 2.3 Add owner-scoped create/reuse, rotate, and revoke endpoints.
- [x] 2.4 Add failing API tests proving ineligible, non-owner, revoked, expired,
  rotated, hidden, deleted, and malformed links do not disclose content.
- [x] 2.5 Add the public allowlisted meeting projection, uniform unavailable
  response, no-store/noindex/no-referrer headers, and restrictive CSP.

## 3. Owner and public pages

- [x] 3.1 Add failing route and UI tests for `/notes/:jobId`, legacy deep-link
  compatibility, and explicit new-tab archive links.
- [x] 3.2 Build the owner detail page for queued, active, failed, and completed
  jobs using the existing owner detail API and artifact reader.
- [x] 3.3 Add share status, copy/create, rotate, expiry, and revoke controls only
  for eligible completed jobs.
- [x] 3.4 Add failing public-reader tests proving only allowlisted content is
  rendered and no mutation, export, raw-media, cost, identity, or internal
  evidence controls are present.
- [x] 3.5 Build the framework-free `/share#<token>` reader with first-party
  assets, loading/unavailable states, text selection, and native print support.
- [x] 3.6 Apply the then-approved shared semantic system across dashboard,
  admin, owner detail, and public share pages.
- [x] 3.7 Replace operator per-stage cost rows with one `總費用` item while
  preserving detailed cost reporting in the admin console.
- [x] 3.8 Replace archive-card content expansion with one primary new-tab
  action while retaining full artifacts on the owner detail page.

## 4. Verification

- [x] 4.1 Run the focused share lifecycle/API tests, owner/public page tests,
  affected existing frontend/API tests, and control-plane build.
- [x] 4.2 Strictly validate OpenSpec, scan for stale selectors/routes and public
  DTO leaks, and run `git diff --check`.
- [x] 4.3 Render and inspect dashboard, admin, owner detail, and public share
  pages at 390px, 768px, 1024px, and 1440px for contrast, hierarchy, focus,
  clipping, line length, and horizontal overflow.
- [x] 4.4 Run a local security smoke proving the token is absent from request
  paths/referrers, public responses are not cached/indexed, old tokens fail
  after rotation, and owner deletion immediately closes access.

Deployment, commit, push, release, archive, and pull request actions require
separate authorization.

## 5. Comprehensive review remediation

- [x] 5.1 Require at least 32 UTF-8 bytes for the dedicated share secret and
  add a weak-secret fail-closed regression.
- [x] 5.2 Protect raw recording-job reads with internal authentication, make
  the Python worker send its credential on GET, and reject the documented
  placeholder token in canonical runtime configuration.
- [x] 5.3 Move terminal-history share revocation into the existing repository
  delete/clear operations and remove router-level artifact loading and N+1
  cleanup.
- [x] 5.4 Reuse the canonical anonymous-speaker sanitizer in text exports and
  cover angle-bracket historical speaker codes.
- [x] 5.5 Run focused security/share/repository/worker checks, the affected
  build, strict OpenSpec validation, and a redacted Compose isolation check.

## 6. Architecture review remediation

- [x] 6.1 Exclude complete rendered summary text and `analysisNotes` from the
  structured public DTO, while retaining sanitized text for historical
  non-structured summaries, with API regression coverage.
- [x] 6.2 Remove the built-in admin-console password and make both canonical
  server startup and exported application construction fail closed when their
  dedicated credentials are missing or undersized; require 32 UTF-8 bytes for
  internal-service credentials, reject the former admin default, and require 6
  UTF-8 bytes for admin passwords.
- [x] 6.3 Remove PostgreSQL and MinIO host port publication, require explicit
  backing-service credentials, and reuse them in ScreenApp MinIO consumers.
- [x] 6.4 Run focused authentication/API checks, the affected build, strict
  OpenSpec validation, redacted Compose rendering, and diff hygiene checks.
- [x] 6.5 Replace the ScreenApp join bearer placeholder with the same required
  internal-service credential used by callback authentication.

## 7. UI acceptance ticket #6

- [x] 7.1 Explain sharing eligibility, bearer forwarding, expiry, rotation, and
  revocation in the owner detail surface.
- [x] 7.2 Reject completed artifact shells without readable public content and
  add the share-page no-script state.
- [x] 7.3 Verify the shared reader and owner controls at desktop and 390px, run
  focused tests/build/strict validation, and redeploy the control plane.

## 8. Superseded light-theme acceptance

- [x] 8.1 Replace the rejected pure-black treatment with one brand-led light
  design system across dashboard, admin, owner detail, and public share pages.
- [x] 8.2 Make the dashboard archive visually primary, group capture actions
  into clear responsive cards, and preserve all existing control IDs and flows.
- [x] 8.3 Recompose admin login and governance surfaces into a readable
  responsive workspace without weakening authentication or form semantics.
- [x] 8.4 Render and inspect all four surfaces at 390px and 1440px, run focused
  frontend tests and the control-plane build, and strictly validate OpenSpec.
- [ ] 8.5 Redeploy only the control plane and verify the live assets and routes.

The user subsequently replaced this visual preference with the layered dark
acceptance contract below.

## 9. Superseded violet dark-theme acceptance

- [x] 9.1 Replace the light tokens with a layered near-black, charcoal,
  violet, and cyan design system without restoring the rejected flat-black UI.
- [x] 9.2 Apply the dark system consistently to dashboard, admin login and
  governance, owner detail, public share, loading, empty, status, and print
  states while preserving all existing DOM and interaction contracts.
- [x] 9.3 Verify dark-mode contrast, focus, reduced motion, 125% text scaling,
  390px and 1440px layouts, landscape layout, and page-level overflow.
- [x] 9.4 Run focused frontend tests, control-plane build, strict OpenSpec
  validation, and diff hygiene checks.
- [ ] 9.5 Redeploy only the control plane and verify live assets, routes,
  authentication, health, and rollback readiness.

The user subsequently removed violet and cyan from the accepted visual system.

## 10. Monochrome black-theme acceptance

- [x] 10.1 Replace violet and cyan visual tokens with black, charcoal, gray,
  and white across every maintained frontend surface.
- [x] 10.2 Make icons, primary actions, focus states, progress, atmospheric
  backgrounds, and decorative marks monochrome while retaining semantic error
  clarity and all existing interaction contracts.
- [x] 10.3 Run focused frontend tests, contrast checks, build, strict OpenSpec
  validation, diff hygiene, and multi-size rendered inspection.
- [ ] 10.4 Rebuild and redeploy only the control plane, preserving the configured
  admin password, then verify live assets, routes, authentication, health, and
  rollback readiness.
