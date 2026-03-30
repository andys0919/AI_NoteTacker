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
