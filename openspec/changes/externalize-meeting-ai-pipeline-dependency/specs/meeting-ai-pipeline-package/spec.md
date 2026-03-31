## MODIFIED Requirements
### Requirement: Reusable meeting AI pipeline package
The repository SHALL consume the reusable meeting AI pipeline through an external package dependency instead of keeping a duplicate embedded source copy.

#### Scenario: Local development uses the sibling checkout
- **WHEN** local tests or local Python build steps run inside `AI_NoteTacker`
- **THEN** they resolve `meeting_ai_pipeline` from the sibling checkout under `/home/solomon/Andy/meeting-ai-pipeline`

#### Scenario: Container runtime installs the external package
- **WHEN** the transcription worker image is built
- **THEN** it installs `meeting-ai-pipeline` from the external published repository instead of copying an embedded `packages/meeting-ai-pipeline` tree
