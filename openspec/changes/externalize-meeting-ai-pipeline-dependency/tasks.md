## 1. Implementation
- [x] 1.1 Add failing checks that prove AI_NoteTacker no longer depends on an embedded package copy.
- [x] 1.2 Update local test/build wiring to resolve the sibling `meeting-ai-pipeline` checkout.
- [x] 1.3 Update the transcription worker container to install the external package from GitHub.
- [x] 1.4 Remove the embedded `packages/meeting-ai-pipeline` directory from AI_NoteTacker.
- [x] 1.5 Verify tests, build, and runtime replay after externalization.
