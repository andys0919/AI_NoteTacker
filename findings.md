# Findings

## Initial State
- `F:\GitSource\TestProject\AI_NoteTacker` 為空目錄。
- 目前不存在 `tasks/lessons.md` 與其他追蹤文件。

## Research Notes
- 第一批候選專案已找到，分成兩類：
- 類別 A: 會議 bot / bot API
- `Vexa-ai/vexa`：自架、可把 bot 丟進 Google Meet / Microsoft Teams 做即時逐字稿。
- `screenappai/meeting-bot`：TypeScript + Playwright，自動加入並錄製 Google Meet / Teams / Zoom。
- `attendee-labs/attendee`：Meeting Bot API，支援 Zoom / Google Meet。
- `Meeting-BaaS/meeting-mcp`：偏 API / MCP server，透過 Meeting BaaS 建立 bot、抓 transcript。
- 類別 B: 會議內 captions/transcript 擷取
- `Zerg00s/Live-Captions-Saver`：Microsoft Teams 網頁版 captions 擷取與匯出。
- `sughodke/google-meet-transcripts`：Google Meet captions 擷取到 clipboard。
- `RutvijDv/Meet-Script`：Google Meet captions 擷取並輸出 PDF。
- 類別 C: 本機音訊/畫面擷取
- `kastldratza/zoomrec`：Zoom 無頭容器自動加入並錄製。
- `Glavin001/screenpipe-meeting-assistant`：不加入 bot，直接從本機螢幕/音訊做連續擷取與轉錄。
- `joinly-ai/joinly`：以 meeting URL 加入 Zoom / Google Meet / Teams，提供 live transcript 與 agent 互動。
- `hstr0100/LiveCaptionsLogger`：Windows 11 Live Captions 日誌工具，從系統 captions 區域擷取逐字稿。
- 初步判斷：
- 類別 A 較接近「用 AI 自動進會議做筆記」。
- 類別 B 較接近「不用額外 bot 帳號，但需要你自己已經進到會議」，對語音紀錄需求比較受限於平台 captions。
- 類別 C 較接近「完全不碰平台登入流程，直接從你自己的裝置抓音訊」，但不是獨立 bot 參會。

## Key Filtering Results
- `screenappai/meeting-bot`
- README 明確寫出限制：僅支援可由 direct link 直接加入、不需要 authentication 的會議。
- 支援情境包含 `guest/anonymous participant`。
- 缺點是目前輸出重點偏 recording 檔案，逐字稿不是 readme 主要賣點。
- `Vexa-ai/vexa`
- README 顯示 bot 只需要 meeting ID / passcode / API key，就能對 Google Meet、Teams、Zoom 請求 bot。
- 具備 real-time transcription、錄音儲存、自架能力。
- Zoom 在 README 有明確 caveat：通常需要 Zoom Marketplace approval，未批准前通常只能穩定加入自己帳號建立的會議。
- 對 Meet / Teams 很接近需求；對 Zoom 不完全符合「純連結即可匿名加入」。
- `attendee-labs/attendee`
- API 可直接吃 `meeting_url` 拿 transcript。
- 但 prerequisites 明確要求 Zoom OAuth credentials 與 Deepgram API key。
- 因此不符合「不登入自有帳密 / 不綁平台 credentials」的偏好。
- `joinly-ai/joinly`
- Quickstart 寫明可用 meeting link 讓 joinly 加入 Zoom / Google Meet / Teams。
- 提供 `join_meeting`、`get_transcript`、`transcript://live`。
- 偏 AI agent middleware，不是單純錄音器。
- `kastldratza/zoomrec`
- 可從 CSV 以 URL 或 meeting ID/passcode 自動加入 Zoom。
- roadmap 把 `Sign In to existing Zoom account` 列為未來功能，代表目前主路徑不是先登入既有帳號。
- 偏錄影/錄音，不是完整逐字稿方案，需要再串 Whisper/ASR。
- `Zerg00s/Live-Captions-Saver`
- Teams web extension；加入會議後自動抓 live captions，資料留在本機，不送外部。
- 很符合「不登入自己帳密給第三方」，但前提是你自己已進會議，而且只能抓 captions，不是 raw audio。
- `sughodke/google-meet-transcripts` / `RutvijDv/Meet-Script`
- 都是 Google Meet captions-based 方案。
- 優點：簡單、無後端。
- 缺點：依賴 captions，有可能漏字、受平台 UI 變更影響。
- `hstr0100/LiveCaptionsLogger`
- 不依賴特定會議平台 repo；只要 Windows 11 Live Captions 能顯示，就能把字幕持續寫檔。
- 優點：完全不需要把自己的帳密交給第三方，也不需要 bot 真正加入會議。
- 缺點：本質仍是 captions/OCR 路線，不是直接抓原始音訊流。

## Architecture Decision Follow-up
- 使用者已排除本機系統音訊擷取方案。
- 後續規格將以獨立 worker / container / VM 為前提。
- Whisper 是唯一 STT 方案，不考慮 Deepgram 或其他 hosted STT provider。

## 2026-04-02 Operator History Cleanup
- `Operator Queue` 顯示的舊 failed jobs 來自 PostgreSQL `recording_jobs`，不是前端暫存。
- Dashboard 會把匿名 operator ID 存在 browser `localStorage`，所以同一個 browser session 會持續看到同一個 submitter 的歷史 job。
- 現有 repository 先前只有 `save/get/list/claim`，沒有任何歷史刪除能力，因此必須補 persistence method 才能安全支援 UI 清理。
- 本次 scope 僅清除 job metadata/history，不刪 MinIO 中的 artifacts。

## 2026-04-02 Authenticated Media Archive
- live `.m4a` upload 已實測成功：
- 上傳成功建立 `uploaded-audio` job
- queue 由 `queued` 進入 `transcribing`
- 因此前端體感「沒反應」不是 upload route 完全失敗，而是缺少明顯進度回饋與後段可觀測性
- 實測 job `job_ed81e2d5f0584fc1a040c5560aff743d` 顯示：
- `recording_artifact.contentType = audio/x-m4a`
- 已被 `transcriber-alpha` claim
- 當下仍停在 `transcribing`
- `transcription-worker` 對長時間執行中的 job 幾乎沒有階段性 log，造成卡住與否難以判斷
- 目前 pipeline 對 uploaded media 的流程是：
- raw upload 直接存 MinIO
- transcription worker 直接下載原檔
- downstream transcriber 直接吃該檔案
- 中間沒有明確的 media-preparation / audio-extraction stage
- 目前 identity 模型仍是匿名 `localStorage` operator id，不適合跨裝置 archive 回看或 100 人場景
- 已選定後續身份方案：
- auth: `Supabase Auth` email magic-link
- email delivery: `Brevo Free` custom SMTP
- backend data plane: 保留本地 PostgreSQL + MinIO 為系統真相
- 第一切片實作後的確認：
- `.mp4` uploaded media 會經由 `ffmpeg` 抽出單聲道 16kHz wav，再交給 Whisper
- live worker logs 已看到實際 ffmpeg stream mapping：`aac -> pcm_s16le`, output `/tmp/transcription-prepared-*.wav`
- live API 已返回 completed job，含：
- `processingStage = completed`
- `processingMessage = Transcript and summary generation completed.`
- 完整 transcript segments
- persisted summary artifact
- auth slice 目前採 feature flag：
- app 端只要有 `SUPABASE_URL` 與 `SUPABASE_PUBLISHABLE_KEY` 就會啟用 magic-link 模式
- 無 env 時，前端與 backend 仍走匿名 operator 模式，避免未配置 Supabase 時整站不能用
- backend token 驗證策略：
- 優先走 Supabase JWKS JWT 驗證
- 若 JWT 驗證失敗，fallback 到 `/auth/v1/user` 查詢目前 bearer token 對應使用者

## 2026-04-07 Archive Search + Stale Recovery
- `add-authenticated-media-archive` 已經涵蓋 authenticated archive、durable progress、worker heartbeat，但目前程式實作還沒補齊 archive search 與 transcription stale reclaim。
- `operator jobs` API 目前只支援按 submitter / auth user 列出 jobs，沒有 query search。
- dashboard 目前也沒有 archive/job search input，因此 archive 可回看但不可快速定位。
- transcription stuck recovery 目前只處理：
- 轉錄期間主動回報 `transcription-failed`
- meeting-link runtime idle 時清 stale joining/recording jobs
- 但沒有處理「transcription worker crash 後 lease 留在 DB」的自動回收。
- 現行 `recording_jobs.updated_at` 已會隨 claim / progress / artifact event 更新，可先作為 stale transcription heartbeat surrogate，不必第一刀就加新欄位。
- `add-authenticated-media-archive` design 已明確提到 query-friendly transcript/summary projection 與 durable heartbeat/reclaim，因此這次把搜尋與 stale reclaim 補進同一個 active change 是合理的，不必另開平行 change。
- 本次實作選擇：
- archive search 先走 `/api/operator/jobs?q=...` 的 server-side filter，搜尋欄位含 meeting link、join name、uploaded file name、failure message、summary text、transcript segments text
- 不先改 repository 介面或另建 FTS index，先用現有 owned-job listing 做第一刀
- stale transcription reclaim 先在 `/transcription-workers/claims` 前掃描 active jobs，用 `updated_at` + `assignedTranscriptionWorkerId` 判斷 stale，再復用既有 `releaseTranscriptionJobForRetry(...)`

## 2026-04-07 Archive Detail Timeline
- `job-progress-tracking` spec 已要求 durable stage history；目前最小可落地模型是直接把 `jobHistory` 作為 job projection 的一部分持久化，而不是先拆新表。
- 直接把每一次百分比 update 都寫進 timeline 會造成長音檔 history 噪音，因此 `updateRecordingJobProgress(...)` 只在 stage 或 message 改變時才 append 新 entry。
- 把 timeline 顯示在現有 job card 內，比先做新 route / modal / drawer 成本更低，也足以滿足「archive detail + history timeline」第一刀。

## 2026-04-07 Terminal Email Notifications
- 最小可靠通知切片是「authenticated operator terminal email notifications」，不先做 UI toggle、不先做 Slack/Telegram 多通道。
- `completed` 通知目前在 job 第一次進 terminal `completed` 時送出；若之後 `summary-artifact-stored` 再次保存同一 completed job，會因持久化 notification state 而避免 duplicate。
- 通知觸發需要同時滿足：
- job 到達 `completed` 或 `failed`
- `authenticatedUserRepository` 可解析 submitter 對應 email
- `jobNotificationSender` 已配置
- 尚未為同一 terminal state 發送過
- SMTP transport 採 env-driven wiring：
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `npm install` 後顯示有 2 個 high severity vulnerabilities；本次未處理，功能驗證不受影響，但之後應另做 dependency hygiene。

## 2026-04-07 Archive Export Formats
- 最小實用 export 切片選為 `Markdown / TXT / SRT / JSON`：
- `Markdown` 適合文件與 Notion
- `TXT` 適合純文字存檔
- `SRT` 適合字幕工具
- `JSON` 適合程式或下游整合
- export route 採 owner-scoped operator API：`GET /api/operator/jobs/:id/export?format=...`
- 匿名模式時沿用 `submitterId` query；authenticated 模式時由 bearer token 決定 owner
- `SRT` 僅在 transcript segments 存在時可匯出；其餘格式接受 transcript 與 summary 的現有 projection
- dashboard 端不需要新頁面；直接在 job card 加 export buttons + blob download 即可先滿足需求

## 2026-04-07 Structured Summary Sections
- 最穩定的做法不是從 Markdown 再反解析，而是要求 Codex 直接回 JSON，然後本地再 render 回 Markdown text。這樣可以同時得到：
- `summaryArtifact.text`
- `summaryArtifact.structured`
- `meeting-ai-pipeline` 的 sibling checkout 已更新，但 runtime container 原本會從 GitHub `meeting-ai-pipeline@main` 安裝舊版 package；因此需要把 worker runtime import 改到本地 wrapper，否則容器不會吃到這次 structured summary 變更。
- 本次 structured summary fields 採：
- `summary`
- `keyPoints`
- `actionItems`
- `decisions`
- `risks`
- `openQuestions`
- root Python test script 已擴成同時跑 external package tests 與 worker tests，避免 package 層變更只在手動命令下才被驗證。
