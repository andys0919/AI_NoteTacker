# Task Plan

## Goal
找出 GitHub 上是否已有可加入 Zoom / Google Meet / Microsoft Teams 會議、以 AI 或自動化方式做筆記/錄音/逐字稿的專案，優先篩選不需要登入使用者自有帳密、可透過會議連結加入、目前先聚焦語音紀錄的方案。

## Follow-up Goal
使用 OpenSpec 為「獨立會議 bot + Whisper 逐字稿」方向建立正式規格，避免後續直接進入實作前缺少架構與需求邊界。

## Phases
- [x] Phase 1: 初始化規劃與工作記錄
- [x] Phase 2: 搜尋 GitHub 與相關專案頁
- [x] Phase 3: 依需求條件篩選
- [x] Phase 4: 整理結果與限制

## Constraints
- 優先使用 GitHub repo/readme 作為第一手來源
- 著重是否支援透過 meeting link 加入會議
- 著重是否避免要求使用者提供自有帳密/OAuth
- 目前先看語音紀錄、錄音、逐字稿，不先延伸到完整 action items

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `tasks/lessons.md` 不存在 | 1 | 初始化 `tasks` 目錄與必要檔案 |
| 工作目錄不是 git repo 且為空目錄 | 1 | 以本地研究工作區方式進行，建立研究記錄檔 |
| `openspec init` 預設互動式，非互動終端中斷 | 1 | 改用 `openspec init --tools codex .` 非互動初始化 |

## 2026-04-02 Operator History Cleanup

### Goal
- 為 operator dashboard 補上 terminal history 刪除能力，支援單筆刪除與一鍵清除，只作用於目前 operator 自己的 `failed` / `completed` jobs。

### Phases
- [x] Phase 1: 建立並驗證 OpenSpec change `add-operator-job-history-controls`
- [x] Phase 2: 先手動清掉 PostgreSQL 中指定 operator 的舊 failed jobs
- [x] Phase 3: 以 TDD 加入 API / repository cleanup 能力
- [x] Phase 4: 更新 dashboard UI 與全量驗證

## 2026-04-02 Authenticated Media Archive

### Goal
- 以正式可擴充的方式，把系統從匿名 dashboard 升級為具名 email magic-link 使用者系統，並支援音訊/影片上傳、可觀測 queue 進度、全文/摘要持久保存與可回看 archive。

### Phases
- [x] Phase 1: 實測 `.m4a` 上傳現況並定位真正瓶頸
- [x] Phase 2: 確認身份模型方向為 email magic-link，並選擇 `Supabase Auth + Brevo Free`
- [x] Phase 3: 建立並驗證 OpenSpec change `add-authenticated-media-archive`
- [ ] Phase 4: 依核准後的 change 分段實作 auth / media-prep / archive / progress UI
  - 已完成第一切片：uploaded media preparation + queue progress + full transcript display
  - auth slice 已完成 backend/frontend scaffolding（feature-flagged）
  - 下一步：接通真實 Supabase magic-link flow與 named-user archive ownership

## 2026-04-07 Archive Search + Stale Recovery

### Goal
- 在既有 `add-authenticated-media-archive` change 內，補上第一批高價值 archive / reliability 能力：
- authenticated operator 可搜尋自己的 archive / job history
- transcription stale lease 可被系統自動回收並重新 claim，避免 worker crash 後 job 永久卡住

### Phases
- [x] Phase 1: 更新 OpenSpec proposal / design / tasks / specs，明確加入 archive search 與 stale transcription recovery
- [x] Phase 2: 以 TDD 補 failing tests，覆蓋 archive search 與 stale transcription reclaim
- [x] Phase 3: 實作 control-plane / dashboard 行為
- [x] Phase 4: 驗證 tests、OpenSpec 與 live retry flow

## 2026-04-07 Archive Detail Timeline

### Goal
- 將既有 archive / job 卡片補成真正可追的 detail view：持久化 job history，並在 dashboard 顯示 stage timeline。

### Phases
- [x] Phase 1: 以 TDD 定義 history 持久化與 API 回傳行為
- [x] Phase 2: 實作 domain / PostgreSQL / API 的 `jobHistory`
- [x] Phase 3: 在 dashboard job card 顯示 timeline
- [x] Phase 4: 驗證 tests、build、OpenSpec

## 2026-04-07 Terminal Email Notifications

### Goal
- 為 authenticated operator 的 terminal jobs 補上 email notifications：`completed` / `failed` 時寄一次，不重複。

### Phases
- [x] Phase 1: 更新 OpenSpec scope，加入 operator notifications requirement
- [x] Phase 2: 以 TDD 補 completion / failure notification regression tests
- [x] Phase 3: 實作 notification state persistence 與 SMTP sender wiring
- [x] Phase 4: 驗證 tests、build、OpenSpec

## 2026-04-07 Archive Export Formats

### Goal
- 讓 operator 可將 completed archive 匯出成 `Markdown / TXT / SRT / JSON`，方便帶到文件、字幕、外部工具。

### Phases
- [x] Phase 1: 更新 OpenSpec scope，加入 exportable archive formats
- [x] Phase 2: 以 TDD 補 export endpoint regression tests 與 ownership 檢查
- [x] Phase 3: 實作 export route 與 dashboard download actions
- [x] Phase 4: 驗證 tests、build、OpenSpec

## 2026-04-07 Structured Summary Sections

### Goal
- 將既有 summary 從純文字升級為「保留 Markdown text，同時提供 structured fields」，至少包含 `action items / decisions / risks / open questions`。

### Phases
- [x] Phase 1: 更新 `add-codex-transcript-summaries` spec 與 tasks
- [x] Phase 2: 以 TDD 補 package / worker / control-plane structured summary tests
- [x] Phase 3: 實作 package summarizer、worker summary event、control-plane schema、dashboard structured summary UI
- [x] Phase 4: 驗證 root tests、build、OpenSpec
