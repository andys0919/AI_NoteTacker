# Change: Externalize Meeting AI Pipeline Dependency

## Why
The reusable `meeting-ai-pipeline` package is now published in its own repository, but `AI_NoteTacker` still carries an embedded copy under `packages/meeting-ai-pipeline`. That duplicates source, creates drift risk, and defeats the purpose of extraction.

## What Changes
- Remove the embedded `packages/meeting-ai-pipeline` copy from `AI_NoteTacker`.
- Update local test/build wiring to consume the sibling checkout at `/home/solomon/Andy/meeting-ai-pipeline`.
- Update container/runtime installation to install `meeting-ai-pipeline` from the external GitHub repository.

## Impact
- Affected specs: `meeting-ai-pipeline-package`
- Affected code: transcription worker Dockerfile, local Python test/build scripts, repository layout
