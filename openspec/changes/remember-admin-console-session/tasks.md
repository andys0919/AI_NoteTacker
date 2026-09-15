## 1. Specification and ticket

- [x] 1.1 Create tracking issue `andys0919/AI_NoteTacker#12` for the per-device admin session.
- [x] 1.2 Strictly validate this OpenSpec proposal, tasks, and `internal-service-security` delta.

## 2. Per-device session

- [x] 2.1 Store the admin console token in `localStorage`, adopting and clearing any token left in `sessionStorage`.
- [x] 2.2 Read the same stored token from the admin result page.
- [x] 2.3 Clear both storage locations on logout and on a rejected request.

## 3. Session lifetime

- [x] 3.1 Raise the default session lifetime to 30 days, still enforced against the signed expiry server-side.
- [x] 3.2 Document the setting and its trade-off in `.env.example`.

## 4. Verification and review

- [x] 4.1 Add focused regressions for the storage location, the one-time adoption, and clearing on logout.
- [x] 4.2 Run the control-plane typecheck and test suite, and compare failures against the pre-change baseline.
- [x] 4.3 Verify on the deployed console that a new tab reuses the session.
