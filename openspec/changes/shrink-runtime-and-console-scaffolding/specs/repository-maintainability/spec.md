## ADDED Requirements

### Requirement: Simplification removes only behavior-unowned source
Repository simplification SHALL remove source and focused tests only when no
maintained runtime path consumes them, while preserving active observable behavior.

#### Scenario: Maintainer removes console scaffolding
- **WHEN** the console stylesheet and browser modules are simplified
- **THEN** removed CSS declarations were shadowed by a later declaration with the same selector, property, and conditional context
- **AND** removed browser helpers, view-model fields, and focused tests have no maintained runtime caller
- **AND** an exact mechanical-output comparison plus focused viewport contract tests retain the active console behavior
- **AND** desktop and narrow dashboard and admin-login renders retain complete, unclipped content without horizontal overflow

### Requirement: Maintained commands use direct platform capabilities
The repository SHALL use available standard-library or direct tool commands instead
of duplicate parsers, wrapper-only scripts, or configuration switches with no
maintained alternate state.

#### Scenario: Maintainer runs repository scripts and local summary configuration
- **WHEN** runtime probes parse command-line options and the Python worker is compiled
- **THEN** probes use Node's standard argument parser
- **AND** the root build command invokes Python `compileall` without a repository wrapper
- **AND** local Codex summary readiness does not depend on an always-true environment switch
