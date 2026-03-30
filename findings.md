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
