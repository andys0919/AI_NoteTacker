## ADDED Requirements

### Requirement: Cloud monetary displays use one TWD presentation
The operator dashboard and admin console SHALL use the same TWD formatter for
all cloud cost and quota values.

#### Scenario: Operator views a completed meeting record
- **WHEN** the record has a positive priced cloud cost
- **THEN** the record shows one `總費用` value prefixed with `NT$`
- **AND** does not expose a parallel USD amount or stage-level subtotals

#### Scenario: Operator views a partially priced meeting record
- **WHEN** the record has a positive known subtotal and an unpriced remainder
- **THEN** the record labels the converted subtotal as `已知費用`
- **AND** keeps an explicit unpriced-usage warning instead of presenting the subtotal as complete spend

#### Scenario: Administrator manages cloud usage
- **WHEN** the administrator views usage details or edits quota values
- **THEN** cost, reservation, remaining, total, and quota values are shown in TWD
- **AND** quota submissions are converted back to the existing USD API contract

#### Scenario: Administrator audits a provider request
- **WHEN** the administrator opens a job or usage-history request detail
- **THEN** the interface shows request outcome, actual provider/model, start and finish time, provider request ID when available, and pricing status
- **AND** it shows MAI raw/billed duration or Responses token categories without hiding unmetered requests
- **AND** the responsive detail uses progressive disclosure without breaking the page viewport

#### Scenario: A page loads the current conversion reference
- **WHEN** an operator or administrator opens a cost-bearing page
- **THEN** the page applies the verified server-provided USD-to-TWD reference before rendering current cost and quota values
- **AND** an invalid or unavailable response leaves the bundled last-known-good reference in place
