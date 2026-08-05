## ADDED Requirements

### Requirement: Maintained code has an active execution or verification owner
The repository SHALL not retain production modules, injectable collaborators, exported helpers, or focused tests solely for behavior that no active entrypoint can execute.

#### Scenario: Maintainer checks references after simplification
- **WHEN** the repository is searched for removed browser modules, worker collaborators, and exported helpers
- **THEN** no active source or test imports those removed symbols
- **AND** tests remain focused on behavior reachable through the maintained runtime

### Requirement: Operational instructions use canonical sources
The repository SHALL keep one authoritative specification/history path and one canonical command path for each maintained operation.

#### Scenario: Maintainer follows deployment and verification documentation
- **WHEN** a maintainer follows repository documentation
- **THEN** deployment commands call the canonical deploy script directly
- **AND** test commands call the root npm scripts directly
- **AND** completed agent scratch logs or duplicate design copies are not presented as parallel sources of truth
