# Change: Remove the control-plane uploaded-media byte limit

## Why

The upload endpoint rejects supported media once it crosses the configured
512 MiB Multer limit. Operators need to submit larger recordings, and the
control plane already writes uploads to disk instead of buffering the entire
body in application memory.

## What Changes

- Remove the control-plane application-level byte limit for uploaded media.
- Keep disk-backed upload handling, multipart field/file/part limits, MIME
  validation, storage cleanup, and transcription queue policy.
- Update the media-ingestion contract and focused regression coverage so a
  supported upload is not rejected solely because of its byte size.

This supersedes the 512 MiB upload-boundary behavior in
`improve-uploaded-meeting-note-quality`.

## Impact

- Affected specs: `media-ingestion`
- Affected code: `apps/control-plane/src/app.ts`,
  `apps/control-plane/test/recording-jobs-api.test.ts`
- No reverse-proxy, object-storage, filesystem, or provider-side limits are
  changed; those remain external capacity boundaries.
