## Context

The transcription and summary services are independently scheduled but currently
build the same 4 GB-class Python image. That image installs Whisper, CUDA, FFmpeg,
S3/OpenCC packages, Node, npm, and Codex even though the two entrypoints consume
disjoint halves of those dependencies. The Node service images also retain the
development dependencies used to compile and test them.

The console stylesheet has accumulated two later redesign layers. Many earlier
declarations are now unreachable in the cascade, while a small set of exported
browser helpers and view-model fields are referenced only by their own tests.

## Goals / Non-Goals

**Goals:**
- Keep one Dockerfile per existing service family while producing dependency-
  isolated runtime targets.
- Remove build/test dependencies from final Node images.
- Delete only mechanically provable CSS and JavaScript dead weight.
- Use standard-library and direct command paths instead of maintained wrappers.

**Non-Goals:**
- Change provider selection, job lifecycle, API/schema behavior, security,
  accounting, artifact fidelity, or console presentation.
- Add a CSS build step, optimizer dependency, frontend framework, image registry,
  cache service, or release pipeline.
- Deploy, archive OpenSpec changes, create a tag/release, or open a pull request.

## Decisions

### 1. Use named targets in the existing Python Dockerfile

A small Codex build stage supplies the Node executable and pinned Codex package to
the summary target. The transcription target installs FFmpeg, Python provider
packages, and pinned CUDA libraries. Compose selects the target explicitly, and
the transcription target remains the Dockerfile's default final stage for direct
build compatibility.

This removes cross-stage packages without introducing a second Dockerfile or a
new dependency-management system.

### 2. Use ordinary Node build/runtime stages

The control-plane builder compiles TypeScript and prunes development dependencies
before its runtime stage copies the built server, public assets, and production
modules. The recording worker has no production package dependencies, so its
runtime stage needs only the compiled output and its package metadata.

### 3. Prune CSS by cascade proof, not visual redesign

A declaration is removable only when a later declaration has the same selector,
property, importance-or-higher, and at-rule context, and the earlier declaration
is not a progressive-enhancement fallback for the later value. The candidate pass
therefore retains equivalent `vh` declarations before newer `dvh` values, including
inside `calc()`. No declaration is moved, so the surviving cascade order and
selector interactions remain unchanged. Empty rules left by that mechanical
deletion are removed.

### 4. Delete configuration with no real off state

`SUMMARY_ENABLED` defaults to true and every maintained deployment sets or relies
on true while the summary worker always runs. Local Codex readiness therefore
becomes unconditional; Azure readiness remains gated by its endpoint and key.
Per-job summary lifecycle behavior is unchanged.

## Risks / Trade-offs

- A target can omit a transitive runtime dependency → build each target and run
  import/entrypoint checks inside the resulting images.
- Pruning Node modules can omit a runtime import → run the control-plane health
  command and recording-worker entrypoint/import checks in final images.
- CSS removal can alter a conditional cascade if matching is too broad → match
  exact selector/property/at-rule context, retain declarations whose values form
  progressive-enhancement fallbacks, compare the result byte-for-byte with the
  mechanically generated output, and retain focused fallback/viewport contract
  tests; use rendered inspection when browser control is available.
- Removing test-only helpers can hide an external script consumer → perform a
  repository-wide reference sweep before and after deletion.

## Migration Plan

1. Add and select the Docker build targets.
2. Remove unreachable console/source/configuration paths and direct wrappers.
3. Synchronize maintained documentation.
4. Run focused tests, builds, Compose/image assertions, rendered console checks,
   strict OpenSpec validation, and two-axis review.

Rollback is a source-level revert. No persisted data or schema changes are
involved. Future archive order is `extract-meeting-ai-pipeline-package` →
`externalize-meeting-ai-pipeline-dependency` →
`remove-unused-runtime-scaffolding` → `shrink-runtime-and-console-scaffolding`.

## Open Questions

None. The user explicitly approved implementation of the preceding audit findings.
