# Change: Keep One Admin Console Session Per Device

## Why

The admin console token lives in `sessionStorage`, which no other tab can read
and which the browser discards when the tab closes. Every result link opened in
a new tab therefore lands on the login form, and the operator retypes the
password several times a day. The session also expires after 12 hours, so even
one long-lived tab asks again the next morning.

The session secret is already configured, so restarts are not the cause; the
storage choice and the short lifetime are.

## What Changes

- Keep the admin console token in `localStorage`, so every tab on that device
  shares one session and closing the browser does not end it. A token found in
  the old `sessionStorage` location is adopted once and then removed.
- Raise the default session lifetime from 12 hours to 30 days, still enforced
  server-side against the signed expiry inside the token.
- Logging out, and any request the server rejects as unauthenticated, clears the
  stored token from both locations.
- Nothing else about admin authentication changes: the password is never stored,
  the token stays signed and expiring, and every admin route still verifies it.

## Impact

- Tracking ticket: `andys0919/AI_NoteTacker#12`
- Affected specs:
  - `internal-service-security`
- Affected code:
  - `apps/control-plane/public/admin.js`
  - `apps/control-plane/public/share.js`
  - `apps/control-plane/src/infrastructure/admin-console-auth.ts`
  - `apps/control-plane/test/admin-shell.test.ts`
  - `.env.example`
- Accepted trade-off: anyone who can use that browser profile reaches the admin
  console without the password until the session expires or is cleared, and the
  token now survives a browser restart. This is deliberate for a single-operator
  console on a trusted machine; shared machines should log out.
