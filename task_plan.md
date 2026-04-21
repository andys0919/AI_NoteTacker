# Task Plan

## Goal

Verify that the current runtime hardening changes are actually working end to end, run the full available verification surface, identify any missing regression coverage in the touched codepaths, and add the tests needed to close those gaps before making any correctness claim.

## Phases

| Phase | Status | Notes |
| --- | --- | --- |
| 1. Re-orient on current repo state and touched surfaces | completed | Reviewed worktree, scripts, planning files, and current test inventory. |
| 2. Run full baseline verification | completed | `npm test` initially failed in control-plane and recording-worker heartbeat paths; targeted Python heartbeat tests also failed. |
| 3. Investigate failures or weak coverage | completed | Confirmed the root causes were missing heartbeat route/client/loop behavior, missing generic lease fields on claim responses, and stale-check logic that still trusted `updatedAt` too much. |
| 4. Add failing tests and implement minimal fixes | completed | Added worker client heartbeat regression tests and internal-route auth coverage, then implemented the missing heartbeat contract across control-plane and workers. |
| 5. Re-run verification and summarize residual risk | completed | Re-ran targeted tests, full `npm test`, full `npm run build`, compose config validation, and a live docker-compose smoke successfully. |
| 6. Continue OpenSpec runtime health slice | completed | Added admin-only runtime health aggregation and dashboard rendering, then re-ran targeted runtime-health tests, the full control-plane suite, and the control-plane build. |
| 7. Re-verify meeting-platform readiness after local platform and summary fixes | completed | Added Zoom `pwd=` acceptance and dispatch coverage, fixed local Codex summary defaults/error reporting, then re-ran full tests/build plus live smoke for Google Meet, Teams, and Zoom. |
| 8. Close remaining direct-link gaps on supported meeting platforms | completed | Added regression coverage for Zoom web-client `wc/join` URLs and widened control-plane policy to accept them. |
| 9. Prove host-approved meetings actually reached join-request submission state | completed | Added shared join-request evidence detection plus control-plane persistence of `waiting-for-host-admission` for Google Meet, Teams, and Zoom. |
| 10. Close live-runtime gaps revealed by a real Google Meet run | in_progress | Live Meet verification proved the bot clicked `Ask to join`, entered the meeting, and started recording, but also exposed stale control-plane progress for the old meeting-bot container and a broken `large-v3` Whisper startup cache. |

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| Root `npm test` failed in heartbeat-related control-plane and recording-worker tests | 1 | Investigated and found missing lease heartbeat route/client/loop support plus missing generic lease fields on worker claim responses. |
| Targeted Python heartbeat tests raised `unexpected keyword argument 'heartbeat_interval_ms'` and missing `post_lease_heartbeat` | 1 | Added heartbeat loop support and client method in transcription and summary worker paths. |
| New recording-worker heartbeat client test first failed because the test used an invalid Google Meet URL | 1 | Corrected the test fixture to use a supported meeting URL format before evaluating the production behavior. |
| First compose smoke run inherited persisted Azure provider settings from an old Postgres volume | 1 | Reset the persisted provider and policy rows back to local smoke defaults before the final live smoke run. |
| First compose smoke run failed because the smoke driver required non-empty transcript segments from synthetic audio | 1 | Narrowed the smoke assertion to transcript artifact presence, summary readiness, list/detail visibility, and export success. |
| Live platform smoke failed at summary generation with `Reading additional input from stdin...` | 1 | Reproduced the Codex CLI call in-container, confirmed the real root cause was unsupported/quota-limited default summary models plus misleading stderr handling, then switched defaults to `gpt-5.4-mini` and surfaced structured stdout errors. |
| Follow-up Zoom audit showed that `app.zoom.us/wc/join/...` links were still rejected even though the upstream Zoom bot can use them | 1 | Added a failing API regression test first, then widened the Zoom path matcher to accept direct web-client join URLs. |
| First post-change `docker compose ... up` failed with `invalid spec: :/codex-home` | 1 | Re-ran with `CODEX_HOME` exported so compose could resolve the mounted Codex home path correctly. |
| First live log-tail command for the Google Meet verification failed with `invalid spec: :/codex-home` | 1 | Re-ran the compose log command with `CODEX_HOME=/home/solomon/.codex` exported. |
| Live Google Meet verification exposed repeated transcription-worker crashes on `large-v3` startup because the cached snapshot was missing `model.bin` | 1 | Switched the live screenapp runtime back to `WHISPER_MODEL=tiny`, matching the current job snapshots, and restarted only the transcription worker. |
