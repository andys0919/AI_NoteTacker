# Change: Shrink Runtime and Console Scaffolding

## Why
The runtime images and framework-free console still carry build-only dependencies,
stage-exclusive packages, cascade-shadowed CSS, unreachable browser helpers, and
wrapper configuration that active behavior does not need. Keeping them increases
image transfer, attack surface, and maintenance work without adding product value.

## What Changes
- Build transcription and summary workers from separate targets in the existing
  worker Dockerfile so each target contains only its runtime dependencies.
- Build control-plane and recording-worker images in multiple stages so production
  images exclude TypeScript and test dependencies.
- Delete only CSS declarations that are provably shadowed by a later declaration
  with the same selector, property, and conditional context.
- Remove browser helpers, view-model fields, and focused tests that no active
  runtime entrypoint uses.
- Replace duplicate command-line parsing with Node's standard library, call
  `compileall` directly, and remove the always-on `SUMMARY_ENABLED` switch.
- Keep APIs, authentication, recording/transcription/summary behavior, stored
  artifacts, cloud accounting, and rendered console behavior unchanged.

## Impact
- Tracking ticket: `andys0919/AI_NoteTacker#7`
- Affected specs: `deployment-readiness`, `repository-maintainability`
- Affected code: service Dockerfiles, Compose build targets, static console
  JavaScript/CSS and focused tests, root build/runtime scripts, summary provider
  catalog configuration, README/worker/HANDOFF documentation
- Depends on future archival of `remove-unused-runtime-scaffolding` before this
  change because that active change introduces `repository-maintainability`
- No database migration, public API change, new dependency, deployment, release,
  tag, archive, or pull request is included
