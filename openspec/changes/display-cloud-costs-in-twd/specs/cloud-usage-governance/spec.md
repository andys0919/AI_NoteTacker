## ADDED Requirements

### Requirement: TWD presentation does not rewrite USD accounting
The system SHALL retain cloud usage, settlement, reservation, quota, and API
amounts in USD while presenting monetary values to operators and administrators
in TWD using the latest verified Azure TWD reference snapshot.

#### Scenario: A user views a priced cloud amount
- **WHEN** a USD cost or quota is presented in the operator dashboard or admin console
- **THEN** the interface converts it through the shared verified USD-to-TWD rate
- **AND** labels the displayed value as `NT$`
- **AND** the underlying USD ledger and API amount remain unchanged

#### Scenario: The verified conversion snapshot is inspected
- **WHEN** an administrator reviews cloud usage
- **THEN** the console identifies the reference source, conversion rate, and verification date
- **AND** does not describe the reference conversion as the final Azure invoice amount

#### Scenario: Daily TWD reference refresh succeeds
- **WHEN** the exact Azure meter returns complete, currently effective USD and TWD retail prices at startup or the next 24-hour refresh
- **THEN** the system derives one positive USD-to-TWD rate from those prices
- **AND** both currency rows use the same effective date
- **AND** subsequent operator configuration responses expose that rate, source, and refresh time

#### Scenario: Daily TWD reference refresh fails validation
- **WHEN** either exact currency meter is unavailable, malformed, inconsistent, or not yet effective
- **THEN** the system retains the previous verified TWD reference
- **AND** the interface does not receive a zero or partial replacement

#### Scenario: Usage is only partially priced
- **WHEN** a cloud usage total contains an unpriced remainder
- **THEN** the known USD subtotal may be converted to TWD
- **AND** the interface retains an explicit unpriced-usage warning
