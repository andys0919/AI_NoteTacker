# Change: Add Operator Dashboard

## Why
The system currently exposes only raw API endpoints, which makes it awkward for multiple people to submit meetings or uploaded audio and monitor queue state. Operators need a simple web UI with anonymous multi-user support, per-operator concurrency limits, configurable meeting join names, and upload-based transcription.

## What Changes
- Add a dark, tech-themed operator dashboard served by the control-plane.
- Support anonymous operator sessions without username/password auth.
- Enforce at most one actively processing job per operator while allowing additional queued jobs.
- Support meeting-link jobs with configurable bot display name, defaulting to `Solomon - NoteTaker`.
- Support uploaded audio jobs that enter the transcription/summary pipeline without a meeting bot join.

## Impact
- Affected specs: `operator-dashboard`
- Affected code: control-plane domain/API/persistence, queue claim logic, upload handling, static frontend assets
