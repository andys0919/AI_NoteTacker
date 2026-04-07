## ADDED Requirements
### Requirement: Email OTP authentication
The system SHALL authenticate operators through passwordless email OTP.

#### Scenario: User requests sign-in code
- **WHEN** a visitor enters an email address on the sign-in screen
- **THEN** the system requests an OTP email through Supabase Auth using the configured custom SMTP provider

#### Scenario: User completes OTP sign-in
- **WHEN** the user enters a valid emailed OTP on the application sign-in screen
- **THEN** the frontend establishes an authenticated session
- **AND** backend API requests can verify the user's identity from the Supabase-issued access token

### Requirement: Authenticated API enforcement
The system SHALL reject protected operator and archive actions from unauthenticated callers.

#### Scenario: Unauthenticated client calls protected operator API
- **WHEN** a client sends a protected operator request without a valid authenticated session
- **THEN** the API rejects the request
- **AND** no job or archive data is returned
