# Todo

- [x] 建立研究計畫與工作記錄
- [x] 搜尋 GitHub 專案
- [x] 依需求篩選可行方案
- [x] 彙整結果與 review

## Review
- 已找到多個 GitHub 專案。
- 若堅持「只用會議連結、不用提供自有帳密、先以語音紀錄為主」：
- 最接近的是 `screenappai/meeting-bot`。
- 次佳是 `Vexa-ai/vexa`，但 Zoom 有官方 SDK/審核限制。
- 若可接受「你自己先進會議，再抓 captions/音訊」，則 Teams / Google Meet 的 extension 路線最省事。

## OpenSpec Follow-up

- [x] 初始化 OpenSpec
- [x] 完成 autonomous meeting recorder proposal / design / specs / tasks
- [x] 驗證 OpenSpec change

## Implementation Phase 1

- [x] 建立 monorepo 骨架與目錄結構
- [x] 先完成 control plane MVP API
- [x] 補環境範本與本地啟動方式
- [x] 跑測試與驗證

## Implementation Phase 2

- [x] 補 worker callback 事件 API
- [x] 保存 recording / transcript artifact metadata
- [x] 將 repository 介面改為可接持久層的 async 形式
- [x] 跑測試與驗證

## Implementation Phase 3

- [x] 補 PostgreSQL repository 與 schema
- [x] 讓 server 可依環境切換 memory / postgres persistence
- [x] 補 repository integration test
- [x] 跑測試與驗證

## Implementation Phase 4

- [x] 補 worker claim-next job API
- [x] 建立 recording-worker stub package
- [x] 讓 worker stub 可 claim job 並回報 lifecycle / artifact callbacks
- [x] 補 compose 內的 recording-worker service
- [x] 跑測試與驗證

## Implementation Phase 5

- [x] 將 transcription 從 recording worker 拆成獨立 worker 流程
- [x] 補 transcription worker claim API
- [x] 建立 Whisper transcription-worker skeleton
- [x] 將 Python worker 測試與 build 接進 root 驗證流程
- [x] 跑測試與驗證

## Implementation Phase 6

- [x] 補 transcription lease 保護
- [x] 補 transcription retry / terminal failure handling
- [x] 讓 Python transcription worker 在失敗時回報 `transcription-failed`
- [x] 跑測試與驗證

## Implementation Phase 7

- [x] 補 compose startup resilience
- [x] 修正 control plane / worker 啟動時序
- [x] 做 docker compose build / up / job smoke / down 自測

## Implementation Phase 8

- [x] 將 recording worker 抽成 executor 架構
- [x] 補 screenapp meeting-bot HTTP adapter
- [x] 補 meeting-bot completion webhook ingestion
- [x] 新增 `docker-compose.screenapp.yml`
- [x] 做 real meeting-bot dispatch smoke

## Implementation Phase 9

- [x] 補 `teams.live.com/meet/...` link support
- [x] 用真實 Teams Live link 做一次 live smoke
- [x] 確認 meeting-bot 至少已走到 Join now

## Markdown Publish

- [x] 確認本地目錄的 Git 狀態與遠端預設分支
- [x] 整理本次需要提交的 Markdown 檔案範圍
- [ ] 完成 commit / push
- [ ] 補上本次 review 與驗證結果
