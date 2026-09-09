## Context

Multer currently receives a `fileSize` limit of 512 MiB. Its disk destination
keeps the upload file-backed, so removing only that limit does not introduce a
full-body memory buffer in the control plane.

## Goals / Non-Goals

- Goals: accept supported media of any size permitted by ingress, local
  storage, and durable storage; preserve existing validation and cleanup.
- Non-goals: remove multipart abuse limits, bypass MIME validation, change
  queue/quota policy, or promise capacity beyond the infrastructure limits.

## Decisions

- Omit Multer's `fileSize` limit instead of replacing it with a larger magic
  number. Multer's default is unbounded for this field.
- Remove the obsolete `maxUploadBytes` application option and its limit-only
  regression; retain the existing successful upload and temporary-file
  cleanup coverage.

## Risks / Trade-offs

- A very large upload can consume temporary disk or durable-storage capacity.
  Existing disk-backed handling, storage failures, authentication, and queue
  limits remain the available safeguards. A future capacity policy should be
  introduced at ingress or storage with an explicit product requirement.

## Migration Plan

Deploy the control-plane change after focused tests and build validation. To
restore the old behavior, reintroduce the Multer `fileSize` option and the
corresponding contract/test.

## Open Questions

- None for this change.
