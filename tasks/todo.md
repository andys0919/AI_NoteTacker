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
- [x] 完成 commit / push
- [x] 補上本次 review 與驗證結果

## Review

- GitHub `andys0919/AI_NoteTacker` 原先是空倉庫，本次已初始化本地 Git 並推送 `main`
- 首次發布 commit：`f18737c` `feat: publish initial AI NoteTacker project`
- 已補 `.gitignore`，確認 `_inspect_meeting_bot/`、`node_modules/`、`dist/`、`__pycache__/` 未被納入版本控制
- 驗證結果：
- `npm test` 通過
- `npm run build` 通過
- `git push -u origin main` 通過

## Live Test

- [x] 確認 Docker engine 與 compose 可用
- [x] 啟動 `docker-compose.yml` + `docker-compose.screenapp.yml`
- [x] 送入使用者提供的真實 Teams Live meeting link
- [x] 觀察 meeting-bot log、job state 與 webhook/收尾行為
- [x] 補上本次 live test review

## Live Test Review

- 真實 Teams Live link：`https://teams.live.com/meet/9343114235416?p=I4yS5pia1gFxNYOOsV`
- `recording-worker` 成功 dispatch job 到真實 `meeting-bot`
- `meeting-bot` 成功走完：
- 找到 `Join meeting from this browser`
- 填入 bot name
- 點擊 `Join now`
- 進入會議
- 啟動 ffmpeg 錄製
- 因持續靜音 60 秒自動結束錄製
- 完成 object storage upload
- 已證實 `_inspect_meeting_bot` 的 auto-exit / upload 路徑可用
- 觀察到一個整合缺口：
- `meeting-bot` 完成錄製後，control-plane 沒有自動收到 completion webhook，job 卡在 `joining`
- 以手動補 `POST /integrations/meeting-bot/completions` 的方式後，job 成功進入 `transcribing` 並最終到 `completed`
- 結論：
- 真實加入 Teams Live、錄製、靜音自動退出、上傳錄檔：已驗證
- control-plane 自動 ingest meeting-bot completion webhook：本次未自動成功，需再查 webhook delivery 缺口

## Webhook Bugfix

- [x] 重現 `meeting-bot` completion payload 缺少 `metadata.storage` 時的 400
- [x] 新增 regression test 覆蓋 `blobUrl` fallback 路徑
- [x] 修正 control-plane completion webhook schema 與 artifact key 推導
- [x] 重新跑 test / build
- [x] 用 runtime request 驗證修正後容器可接受實際 payload 變體

## Webhook Bugfix Review

- root cause：
- `_inspect_meeting_bot` 目前實際送出的 completion payload 不含 `metadata.storage`
- control-plane 原本要求 `metadata.storage.key` 必填，因此自動 webhook 會回 400
- 修正內容：
- control-plane 現在接受 `metadata.storage` 缺失的 completion payload
- 若缺少 `storage.key`，會改由 `blobUrl` 路徑推導 `recordingArtifact.storageKey`
- 驗證結果：
- 新增 regression test 後先 red，再修到 green
- `npm test` 通過
- `npm run build` 通過
- 重新建一筆 runtime job 並送出「缺少 storage、只有 blobUrl」的 payload，容器回應 `transcribing`
