# Gates: Admin final results and official weekly allowance

OWNS: apps/control-plane/**, workers/transcription-worker/**, openspec/changes/refine-admin-results-and-codex-usage/**

Scope: Implement the three requested admin outcomes and review against the specification; central runtime dependency changes are separately scoped to its usage reader and authenticated route.

- [x] G1: The change specification is valid
  CHECK: openspec validate refine-admin-results-and-codex-usage --strict --no-interactive
  EXPECT: is valid
  EVIDENCE: automatic-evidence=v1; definition-sha256=a8d7fffc276cf500a5f40fc70024ba12375ef24b3f22e87d62d532c5e02bff4d; exit=0; EXPECT=matched; output-sha256=7db3210d36b215757dcd551b81f87bd504ed054d05a830fd939c881e84027a6d; output-bytes=55; shell=/bin/sh; cwd=/home/solomon/Andy/AI_NoteTacker; path=d7d4496daef6/18 entries

- [x] G2: Admin allowance, removed surfaces, and final-result contracts pass focused regressions
  CHECK: npm exec --workspace @ai-notetacker/control-plane -- vitest run test/admin-console-api.test.ts test/admin-shell.test.ts test/governance-panel.test.ts test/meeting-share-api.test.ts test/meeting-share-browser-behavior.test.ts && npm exec --workspace @ai-notetacker/control-plane -- vitest run test/postgres-recording-job-repository.test.ts -t 'persists and reloads a recording job with artifact metadata|uses full readable transcript'
  EXPECT: Test Files
  EVIDENCE: automatic-evidence=v1; definition-sha256=44877095ff14cc7458908ec976bace94f255e88267e2937282707a2bc25cf220; exit=0; EXPECT=matched; output-sha256=4656812ae6eca7e2f834610f7fe99d52d39f88112c814a74b5b4ee70fb4cfa64; output-bytes=859; shell=/bin/sh; cwd=/home/solomon/Andy/AI_NoteTacker; path=d7d4496daef6/18 entries

- [x] G3: Summary worker consumes official remote usage without requiring local OAuth
  CHECK: PYTHONPATH=workers/transcription-worker/src python3 -m unittest discover -s workers/transcription-worker/tests -p test_codex_transcript_summarizer.py
  EXPECT: /^OK$/m
  EVIDENCE: automatic-evidence=v1; definition-sha256=862c779150941579679f9bc3107bb0cf9ddbe856ef460096f5241f04ed938bb3; exit=0; EXPECT=matched; output-sha256=5393f72f29434843524b38b96f069b711178ef1606706171eda1c845a5e42723; output-bytes=109; shell=/bin/sh; cwd=/home/solomon/Andy/AI_NoteTacker; path=d7d4496daef6/18 entries

- [x] G4: Affected TypeScript builds and browser modules parse
  CHECK: npm run build --workspace @ai-notetacker/control-plane && node --check apps/control-plane/public/admin.js && node --check apps/control-plane/public/share.js
  EXPECT: tsc -p tsconfig.json
  EVIDENCE: automatic-evidence=v1; definition-sha256=38d63c9c8741f4a8a2b5087c368192aa763e8c1397bfc9b3ac520039a01f3d3f; exit=0; EXPECT=matched; output-sha256=a0c854e543e72c7274ab1748c685527dc15b74a72ed2dc090b0687cc65e9e218; output-bytes=80; shell=/bin/sh; cwd=/home/solomon/Andy/AI_NoteTacker; path=d7d4496daef6/18 entries

- [x] G5: Persisted final results and truthful allowance states render correctly on desktop and mobile
  EVIDENCE: /tmp/ai-notetacker-admin-results-OkhTQk/evidence.json and inspected desktop/mobile screenshots; real read-only DB content matched the shared document projection and all 988 transcript segments rendered. Removed sections and startup requests were absent. Current upstream failure rendered unavailable without fabricated usage.

- [x] G6: Standards and Spec reviews have no unresolved actionable findings
  EVIDENCE: Independent admin_standards_review and admin_spec_review follow-ups report 0 unresolved findings after canonical readability, UI expiry, private projection and endpoint documentation corrections.

- [ ] G8: A fresh available official weekly window completes central endpoint to worker to admin readback
  EVIDENCE: Direct official central RPC and the new reader returned a valid team/10080-minute window at 2026-09-08T10:12:55Z. Later full-path readback returned unavailable because both host and container could not resolve chatgpt.com; direct requests to both configured DNS servers timed out. This successful-availability readback remains incomplete.

ABANDON: G8 Current host DNS dependency is unavailable; restore the configured resolver connectivity and repeat only this readback. No host DNS policy or production services were changed.

- [x] G7: Central allowance endpoint preserves authentication and sanitizes its official RPC response
  CHECK: cd /home/solomon/docker-managed/sources/shared/claude-telegram-bot && bun test tests/codex-weekly-usage.test.ts && bun run typecheck && bun run --bun biome check src/codex-weekly-usage.ts src/webhook-ingest.ts tests/codex-weekly-usage.test.ts --diagnostic-level=error
  EXPECT: No fixes applied
  EVIDENCE: automatic-evidence=v1; definition-sha256=c51c9f9275033e570dd173285734f2eb2cb38500acb18b99d706a5d5940484f3; exit=0; EXPECT=matched; output-sha256=9dbba8d832c3575c061ed37fb2ba9fb21e58783257faa13d9d6408764798d481; output-bytes=502; shell=/bin/sh; cwd=/home/solomon/Andy/AI_NoteTacker; path=d7d4496daef6/18 entries
