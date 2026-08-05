## ADDED Requirements

### Requirement: Cloud monetary displays use one TWD presentation
The operator dashboard and admin console SHALL use the same TWD formatter for
all cloud cost and quota values.

#### Scenario: Operator views a completed meeting record
- **WHEN** the record has a positive priced cloud cost
- **THEN** the record shows one `總費用` value prefixed with `NT$`
- **AND** does not expose a parallel USD amount or stage-level subtotals

#### Scenario: Administrator manages cloud usage
- **WHEN** the administrator views usage details or edits quota values
- **THEN** cost, reservation, remaining, total, and quota values are shown in TWD
- **AND** quota submissions are converted back to the existing USD API contract

#### Scenario: A page loads the current conversion reference
- **WHEN** an operator or administrator opens a cost-bearing page
- **THEN** the page applies the verified server-provided USD-to-TWD reference before rendering current cost and quota values
- **AND** an invalid or unavailable response leaves the bundled last-known-good reference in place
