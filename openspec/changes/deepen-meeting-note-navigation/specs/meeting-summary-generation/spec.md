## ADDED Requirements

### Requirement: Topic hierarchy preserves supported process relationships
The summary generator SHALL keep supported process order and dependencies
explicit inside the existing topic and subtopic hierarchy.

#### Scenario: One decision domain contains a process and exceptions
- **WHEN** transcript evidence supports prerequisites, normal flow, exceptions,
  recovery, ownership, or an outcome for one decision domain
- **THEN** related subtopics preserve that supported dependency order
- **AND** details state the supported subject, action, condition, and result
  without inventing absent elements

#### Scenario: One topic depends on another topic
- **WHEN** the transcript explicitly states that one topic depends on another
- **THEN** the dependent topic names that supported relationship in its details
  or conclusion
- **AND** the generator does not infer a dependency from proximity alone
