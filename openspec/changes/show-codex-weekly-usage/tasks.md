## 1. Contract

- [x] 1.1 Add and strictly validate the Codex weekly-usage change.

## 2. Worker and API

- [x] 2.1 Reuse the Codex rate-limit reader and project the seven-day bucket.
- [x] 2.2 Report the sanitized snapshot through the existing summary claim poll.
- [x] 2.3 Expose the latest snapshot only through an authenticated admin endpoint.

## 3. Admin UI

- [x] 3.1 Add an accessible weekly remaining/used meter with reset and observed times.
- [x] 3.2 Render explicit unavailable behavior without fabricated percentages.

## 4. Verification and rollout

- [x] 4.1 Run focused worker, control-plane API, and static UI tests/builds.
- [x] 4.2 Deploy the affected services and verify the live admin endpoint and page source.
- [ ] 4.3 Inspect the live rendered desktop/mobile layout when the in-app Browser
  control surface is available.
