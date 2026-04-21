## ADDED Requirements
### Requirement: Authenticated internal worker and webhook routes
The system SHALL require internal service authentication for worker claim routes, worker event routes, and meeting-bot callback routes.

#### Scenario: Unauthenticated internal route request is rejected
- **WHEN** a request reaches an internal worker or webhook route without a valid internal service credential
- **THEN** the system rejects the request
- **AND** no job state mutation occurs

#### Scenario: Authenticated internal service request is accepted
- **WHEN** a trusted internal worker or meeting-bot service sends a request with valid internal service authentication
- **THEN** the route may process the request normally
- **AND** operator-facing browser credentials are not required for that internal call

### Requirement: Internal routes stay off public ingress
The system SHALL define deployment boundaries that keep internal worker and webhook routes off public ingress or otherwise restricted to trusted networks.

#### Scenario: Public operator dashboard is exposed
- **WHEN** the operator and admin dashboard is exposed through public ingress
- **THEN** internal worker and webhook routes remain private or separately restricted
- **AND** public browser callers cannot use ordinary dashboard reachability to invoke internal state-mutation routes
