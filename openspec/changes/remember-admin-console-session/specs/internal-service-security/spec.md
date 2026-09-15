## ADDED Requirements

### Requirement: The admin console keeps one session per device
The admin console SHALL persist its session token per device so that every tab
shares one login, and SHALL keep verifying that token on the server for every
admin route.

#### Scenario: Operator opens a result link in a new tab
- **GIVEN** an operator has logged in to the admin console in one tab
- **WHEN** they open an admin result link in another tab on the same device
- **THEN** the console reuses the stored session without asking for the password again
- **AND** the request still carries the signed session token for server-side verification

#### Scenario: Operator closes and reopens the browser
- **GIVEN** an operator has logged in to the admin console
- **WHEN** the browser is closed and reopened within the session lifetime
- **THEN** the console is still authenticated
- **AND** the session lifetime remains bounded by the signed expiry inside the token

#### Scenario: Session ends
- **WHEN** the operator logs out, or the server rejects a request as unauthenticated
- **THEN** the stored token is removed from the device
- **AND** the console returns to the login form

#### Scenario: Credentials are never stored
- **WHEN** the console stores a session
- **THEN** it stores only the signed, expiring session token
- **AND** it never stores the admin username or password
