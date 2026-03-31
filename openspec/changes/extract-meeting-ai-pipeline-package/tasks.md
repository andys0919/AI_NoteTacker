## 1. Implementation
- [x] 1.1 Add failing tests that describe the reusable package import and pipeline behavior.
- [x] 1.2 Create the shared Python package layout and package metadata.
- [x] 1.3 Move reusable GPU Whisper and Codex summary logic into the shared package.
- [x] 1.4 Refactor `transcription-worker` to use the shared package as an adapter.
- [x] 1.5 Update local test/build/runtime wiring so both the repo and external consumers can import the package.
- [x] 1.6 Verify tests, build, and a runtime replay through the refactored package path.
