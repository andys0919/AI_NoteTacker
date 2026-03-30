## 1. OpenSpec And Repository Setup

- [x] 1.1 Create the initial application repository structure for control plane, recording worker, and transcription worker.
- [x] 1.2 Add environment templates for PostgreSQL, object storage, Whisper runtime, and worker execution.
- [x] 1.3 Add Docker Compose or equivalent local orchestration for API, storage, database, and worker services.

## 2. Recording Job Management

- [x] 2.1 Implement the recording job data model and persistent lifecycle states.
- [x] 2.2 Implement meeting-link intake and support-matrix validation before worker dispatch.
- [x] 2.3 Implement status and result retrieval endpoints for recording jobs.

## 3. Isolated Meeting Recording Workers

- [x] 3.1 Fork or vendor the selected `screenappai/meeting-bot` base into the project workspace.
- [x] 3.2 Adapt the worker so recordings always happen in dedicated worker-local browser and media environments.
- [x] 3.3 Implement artifact upload and job-state callbacks from recording workers to the control plane.
- [ ] 3.4 Validate the first supported platform flow end-to-end with a guest-access meeting.

## 4. Whisper Transcription Pipeline

- [x] 4.1 Add a transcription worker using Whisper via `faster-whisper`.
- [x] 4.2 Implement extraction of transcript segments and timestamp metadata from Whisper output.
- [x] 4.3 Persist transcript artifacts and link them to the originating recording job.
- [x] 4.4 Add retry and failure handling for transcription jobs without introducing hosted STT fallbacks.

## 5. Verification And Operations

- [x] 5.1 Add unit tests for meeting-link validation, job-state transitions, and transcript artifact association.
- [ ] 5.2 Add integration tests for recording worker callbacks and object-storage persistence.
- [ ] 5.3 Add an operator runbook covering supported meeting policies, deployment requirements, and failure modes.
- [x] 5.4 Validate the OpenSpec change with `openspec validate` before implementation is considered ready.
