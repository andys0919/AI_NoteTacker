## ADDED Requirements

### Requirement: Service images contain only runtime-owned dependencies
The canonical deployment SHALL separate build-only tooling and stage-exclusive
runtime dependencies from each final service image without adding a parallel
release path.

#### Scenario: Worker images are built from the canonical Compose configuration
- **WHEN** maintainers build the transcription-worker and summary-worker services
- **THEN** Compose selects separate named targets from the existing worker Dockerfile
- **AND** the summary image excludes Whisper, CUDA, FFmpeg, S3, and OpenCC runtime packages
- **AND** the transcription image excludes Node, npm, and Codex
- **AND** each image can import and start its configured Python entrypoint

#### Scenario: Node service images are built for production
- **WHEN** maintainers build the control-plane and recording-worker services
- **THEN** TypeScript compilers, test runners, source-only execution tools, and type packages are absent from the final images
- **AND** the final control-plane can serve its health endpoint and static console assets
- **AND** the final recording worker can start its compiled entrypoint
