## 1. Implementation
- [x] 1.1 Add failing control-plane tests for admin-only transcription provider read/update APIs and readiness validation.
- [x] 1.2 Add failing persistence/domain tests for durable global provider settings and job-level provider latching.
- [x] 1.3 Add failing transcription worker tests for selecting `faster-whisper` vs Azure OpenAI transcribers based on the effective provider.
- [x] 1.4 Implement server-side admin authorization for provider management using configured admin identities.
- [x] 1.5 Implement durable provider settings storage and control-plane admin APIs that expose non-secret provider metadata only.
- [x] 1.6 Extend transcription job claim/runtime flow so each claimed job records the effective provider used for that attempt.
- [x] 1.7 Implement the Azure OpenAI `gpt-4o-mini-transcribe` adapter and worker-side provider factory while keeping the local Whisper adapter intact.
- [x] 1.8 Add an admin-only dashboard panel to view the current provider and switch between local Whisper and Azure OpenAI.
- [x] 1.9 Update env/documentation and verify with tests, build, and OpenSpec validation.
