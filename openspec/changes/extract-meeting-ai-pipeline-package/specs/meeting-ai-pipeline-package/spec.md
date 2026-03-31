## ADDED Requirements
### Requirement: Reusable meeting AI pipeline package
The repository SHALL provide a reusable Python package that exposes the GPU Whisper transcription and Codex transcript summarization pipeline independently from the control-plane worker adapter.

#### Scenario: External project imports the pipeline package
- **WHEN** another project adds the package source path or installs the package from this repository
- **THEN** it can import the shared meeting AI pipeline modules without depending on `transcription-worker` internals

#### Scenario: Existing transcription worker uses the shared package
- **WHEN** the repository transcription worker processes a claimed recording job
- **THEN** it uses the shared meeting AI pipeline package for download, transcription, and optional summary generation
- **AND** the control-plane-visible job behavior remains compatible with the existing worker flow
