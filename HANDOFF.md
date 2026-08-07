# Handoff — MAI 主轉錄、獨立 Codex PTY 主摘要

_更新：2026-08-07（Asia/Taipei）_

## 目標與已核准架構

使用者已核准把 Azure Speech `mai-transcribe-1.5` 改為新工作的主轉錄，並於
2026-07-30 決定正式系統不再做 Speaker 分類；Qwen、Azure OpenAI
transcription 與 Whisper 保留為 operator 可選 fallback。轉寫 worker 不取得或
使用 Azure Luna 設定；summary worker 透過 AI_NoteTacker 自己的 shared-runtime
`codex-pty-agent` 執行 `gpt-5.6-luna`、effort `max`。每筆工作都是全新 session、
不使用記憶，canonical production 不 fallback Azure。產品不接收或保存 OAuth token。

處理鏈如下：

1. 主轉錄：`mai-transcribe-1.5`，Azure Speech LLM API、固定 30 秒切片、
   最多三段並行、依時間還原順序、`transcribeStyle=verbatim`，不帶 phrase
   list、forced locale 或比對答案。
2. 逐字稿：MAI provider wording 原樣保存為 `rawText`；MAI locale 為中文時，
   只以既有 OpenCC `s2twp` 將 `displayText` 轉成正體中文並標記 `zh-Hant`，
   不呼叫 Luna 潤稿。
3. Speaker 分類：轉寫 worker 不接 diarization 設定，也不發出
   `gpt-4o-transcribe-diarize` request；歷史 metadata 保留相容，但不進摘要
   prompt、閱讀畫面、管理台逐字稿或文字匯出。
4. 摘要：summary worker 將既有 prompt POST 到自己 stack 內的 authenticated
   `/api/prompt`；agent 固定 `codex-pty`、`gpt-5.6-luna`、effort `max`，使用空
   cwd、每 turn fresh session、memory/profiling 關閉。任何 Prompt API、PTY、登入、
   quota、timeout 或 schema 錯誤均明確失敗，不發 Azure request 或儲存半成品。
5. Cloud usage：每個外部推論 request 在呼叫 provider 前先建立 durable audit，
   再以同一 request ID 保存 actual provider/model、成功或失敗、provider request
   ID、token／raw 與 billed audio、計價狀態與時間。Codex PTY 保存 subscription
   request/token 稽核但不建立 Azure/API actual-cost row，也不宣稱訂閱呼叫為 `$0`；
   保留的 Azure quota fallback code 只允許單次 request，但 canonical production
   credential 為空，因此目前不會觸發。

## 目前 checkpoint

### 2026-08-07 AI_NoteTacker 專屬 Codex PTY runtime 已部署

- 摘要 generation 已移除 `codex exec`，改由 AI_NoteTacker Compose 內唯一的
  HTTP-only shared-runtime process 提供既有 `POST /api/prompt`；沒有呼叫 Report
  agent，也沒有新增 `/api/codex/tasks` 或 `/api/codex/usage`。
- agent 固定 `codex-pty`／`gpt-5.6-luna`／`max`、1 MiB request cap、空的
  `/home/solomon/Andy/AI_NoteTacker/.codex-pty-workdir`、每 turn fresh session，
  memory/profiling/failover 全部關閉。OAuth 帳號可共用，但
  `CODEX_HOME`、PTY namespace 與 session state 均為 bot 專屬。
- focused Python 22 tests、launcher TypeScript typecheck、resolved Compose、
  `use-shared-codex-runtime` strict OpenSpec 與 `git diff --check` 均通過。
  live authenticated structured summary、unauthenticated 401、連續不同 native
  session id，以及 Report/AI concurrent PTY smoke 均通過；兩個服務 running。
- summary worker 仍只用自己的 `CODEX_HOME` 執行
  `account/rateLimits/read` weekly quota probe；model generation 不再由該 worker
  啟動 Codex CLI。Azure summary endpoint/key 在 production 仍固定為空。

### 2026-08-07 Codex weekly allowance in admin settings

- 管理設定新增「Codex 每週額度」區塊，只顯示官方
  `account/rateLimits/read` 的 10,080 分鐘窗口：已用、剩餘、重置時間與資料時間；
  沒有 weekly bucket 或 probe 失敗時顯示不可用，不以 5 小時窗口或 token 數推估。
- summary worker 每 60 秒讀一次並隨既有 claim poll 回報 sanitized snapshot；
  control-plane 不掛 Codex volume、不讀 OAuth，admin API 仍需管理員 session。
- focused Python 32/32、control-plane 35/35、TypeScript build、Python compile、
  `admin.js` syntax 與 strict OpenSpec 通過。canonical scoped deploy 已重建
  control-plane／summary-worker；live admin API 為 `team`、7 天、已用 0%，未登入
  回 401，兩個服務 running／restart count 0，`/health=ok`。
- live page source 已從 `http://10.1.2.158:3000/admin` 讀回新區塊。此 session 缺少
  in-app Browser 控制介面，因此尚未宣稱 desktop／mobile rendered visual inspection。

### 2026-08-07 Local Codex Business runtime identity isolation（歷史 transition）

下列紀錄保留當時 direct-CLI 認證隔離證據；目前 summary generation 已由上方
專屬 Codex PTY runtime 取代，`summary-worker` volume 只負責 weekly quota probe。

- `summary-worker` 已從主機 `/home/solomon/.codex` bind mount 切換為唯一的外部
  Docker volume `ai_notetacker_summary_codex_home`；主機登入仍為 `pro`，runtime
  volume 的安全 plan claim 為 `team`（ChatGPT Business），兩份登入互不覆蓋。
- 新帳號透過官方 device-code flow 直接登入 volume；沒有複製、顯示或保存任何
  OAuth token 到產品設定。獨立 volume 的 `codex login status` 為 ChatGPT，且
  `gpt-5.6-luna|max` 最小 smoke 回覆 `BUSINESS_AUTH_OK`。
- canonical production 只重建 `summary-worker`。live mount 為 read/write named
  volume、worker running／restart count 0、control-plane `/health=ok`；Azure summary
  endpoint/key 仍固定為空，因此 Business 額度、登入或網路失敗都不會轉走 Azure。

### 2026-08-07 Azure summary fallback runtime disable

- 使用者要求保留 Azure fallback 程式與既有設定，但正式 runtime 不得切換到
  Azure。canonical production Compose 現在固定向 summary-worker 注入空白
  `AZURE_OPENAI_SUMMARY_ENDPOINT`／`AZURE_OPENAI_SUMMARY_API_KEY`；`.env` 原值沒有
  被讀取、輸出、刪除或修改，fallback 實作也沒有刪除。
- production Compose 防回歸測試 1/1 通過；部署前 active summary job／lease 為 0。
  `./scripts/deploy.sh restart --no-deps --force-recreate summary-worker` 只重建摘要
  worker。部署後 config 讀回 Azure fallback disabled、Local Codex 為
  `gpt-5.6-luna|max|900` 且 `Logged in using ChatGPT`；worker running、restart count
  0，control-plane `/health=ok`，DB policy 為 `local-codex|gpt-5.6-luna`。
- 此段部署當時沒有 provider smoke call，且仍掛載主機預設 Codex home；該暫態
  已由上方 2026-08-07 Business runtime identity isolation checkpoint 取代。

### 2026-08-06 23:42 ticket #8 contract/UI review remediation（尚未部署）

- GitHub issue `andys0919/AI_NoteTacker#8` 固定本次三項範圍：重新打開
  `update-cloud-summary-azure-responses` 6.7 rollback 演練、把歷史 Azure summary
  credential revoke/rotation 拆成 `simplify-mai-transcription-pipeline` 3.6 未完成
  security action，以及移除只有一個選項的摘要 provider selector。
- 管理台現在以 semantic `output` 顯示固定的「本機 Codex」primary route；儲存治理
  設定時仍從已載入 singleton policy 送出 `summaryProvider`，沒有改 API schema 或
  Azure quota-only fallback。OpenSpec 新增 operator-view scenario，明定不得呈現沒有
  真實替代選項的 selector。
- Focused UI/governance tests 18/18、control-plane TypeScript build、public
  `admin.js` syntax、37/37 all strict OpenSpec 與 `git diff --check HEAD` 通過。
- 本次未讀取、輸出、驗證、修改或輪替 credential，未演練 rollback，未觸發付費
  provider call，也未部署、commit、push 或 archive。`browser` skill 所需的 in-app
  控制介面在本 session 不可用，因此沒有冒充 rendered desktop／390px／keyboard
  證據；`update-cloud-summary-azure-responses` 6.16 正確維持未完成。

### 2026-08-06 23:00 request-binding / cost-trust post-review canonical deployment

- 修正 Azure quota fallback 的最後三個費用信任邊界：reservation 會原子綁定
  第一個 Azure request ID，未保留或第二個 ID 在 provider contact 前回 `409`；
  terminal callback 必須列出該 lease 的全部 finalized request audits，且每筆
  provider/model 都要等於 actual provider/model；explicit `azure-openai` callback
  若沒有 finalized audit ID 會在 usage／lifecycle mutation 前回 `409`，不得退回
  legacy aggregate 產生 phantom cost。
- Azure audit-start 前失敗只保留 reservation，不回報 Azure attribution、usage 或
  request ID；Local Codex 空白或 schema-invalid output 會把同一 request audit
  finalize 為 `failed`／`response-validation-failed`，仍保存可信 token usage，且不會
  先標成功。provider request schema、hash、billing／settlement projection 已從大型
  `app.ts` 抽到單一 `provider-request-audit.ts`；最後一層無價值 middle-man 亦已刪除。
- 最終完整 repo 驗證：control-plane 355、recording-worker 13、Python 130，合計
  498/498 tests；最後 trust-boundary targeted run 55/55；全 repo TypeScript/Python
  build、37/37 strict OpenSpec、`npm audit --omit=dev` 0 vulnerabilities、本機與兩個
  production Python image `pip check` 均通過。Standards／Spec 修後雙軸 review 最終
  都是 no findings；`git diff --check HEAD` 通過。
- 最終 `./scripts/deploy.sh up` 於 22:59 完成，exit 0；control-plane image
  `sha256:4194460323c2...`。全棧 running、restart count 0，control-plane／PostgreSQL
  healthy，PostgreSQL 與 MinIO 仍只暴露 container-private port；`/health=ok`，
  summary/transcription worker 都可從容器內到達 control-plane。
- live migration 讀回 `20260806-summary-fallback-request-binding-v1`，
  `summary_fallback_reservations.request_id` 已存在；singleton policy 為
  `local-codex|gpt-5.6-luna`。部署後 provider request rows、仍為 `started` 的
  possible-unpriced rows 與 fallback reservations 均為 0。Compose stage-isolation
  檢查只輸出 `true`；
  summary-worker `Logged in using ChatGPT`，model／effort／timeout 為
  `gpt-5.6-luna`／`max`／`900`。control-plane dist/public、summary/transcription
  Python source 與 recording-worker dist 的 host/container tree hashes 全部一致。
- Azure CLI Cost Management read-only 對帳（截至本次查詢）：Fast Transcription
  2026-08-05 為 6,668 billed seconds／TWD 21.5883168；舊 app raw aggregate 為
  6,603.792 秒／USD 0.660379，依 legacy row 逐筆向上取整為 6,607 秒／USD
  0.660700，仍差 61 秒，因歷史資料沒有 provider-upload request boundary，不能
  回推歸因。2026-08-06 已 ingest 550 billed seconds／TWD 1.78068，與 app 5 筆
  legacy row 逐筆向上取整 550 秒／USD 0.055000 完全一致；舊 raw-duration aggregate
  USD 0.054880 少 USD 0.000120，正是缺少逐 request 秒數進位造成。
- 同一 Cost Management 查詢顯示 Luna resource-level 2026-08-05 cached/input/output
  分別 11.499136M／46.433639M／260.294702M tokens，費用 TWD
  37.2296027136／1503.335496264／50563.807631712；2026-08-06 分別
  3.153408M／8.796075M／52.341604M，費用 TWD
  10.2094737408／284.7817242／10167.670626624。反推仍為 USD
  0.10／1.00／6.00 每百萬 tokens（invoice FX 32.376），證明 catalog 單價運算；
  但這些列是 subscription/resource-level，不是本 app 專屬。app 舊 summary ledger
  只有 2026-08-05 8 rows／139,183 tokens、2026-08-06 4 rows／96,880 tokens，且舊列
  未定價；新 request ledger 查詢當時尚無這兩日 summary request rows，不能把 Azure
  resource totals 硬配給 app。新 request-level ledger 從本次版本起提供可配對邊界。
- 本次沒有觸發任何付費 provider call，沒有讀取、輸出、修改、驗證或輪替任何 key，
  沒有新增 OAuth token 輸入／儲存，也沒有 commit、push、tag、PR 或 archive。
  in-app Browser 所需的 Node REPL tool 本次不可用，因此 UI 完成靜態 accessibility、
  responsive contract 與 live asset/hash 驗證，但沒有冒充新的 rendered screenshot。

### 2026-08-06 21:50 request-level cost audit canonical production deployment

- `./scripts/deploy.sh up` 以 base + ScreenApp canonical topology 完成，exit 0。
  control-plane、summary-worker、transcription-worker image 分別為
  `sha256:fe5d25feaf60...`、`sha256:5c285dfc761f...`、
  `sha256:52164653d09c...`；全棧 running、restart count 0，control-plane 與
  PostgreSQL healthy，PostgreSQL／MinIO 維持 container-private ports。
- `/health=ok`；summary、transcription、recording worker 從容器內讀取
  control-plane 都成功。summary-worker 為 Codex CLI `0.146.0`、
  `Logged in using ChatGPT`、`gpt-5.6-luna`／`max`；有效 singleton policy 讀回
  `local-codex|gpt-5.6-luna`。部署映像內 6 個 control-plane 檔與 6 個 worker
  檔 SHA-256 均逐檔等於工作樹。
- live migration 為 `20260806-provider-request-ledger-v1`；
  `provider_request_ledger` 與 5 個查詢索引均存在。以 synthetic subscription row
  在同一 transaction 驗證 `started -> failed -> readback` 後 ROLLBACK，殘留 0；
  部署後尚未有真實 provider request，故正式 ledger baseline 仍為 0。
- 完整 repo 驗證為 493/493 tests、全 repo build、37/37 strict OpenSpec、
  `git diff --check`、production `npm audit` 0 vulnerabilities、兩個 Python production
  image 的 `pip check` 無 broken requirements，以及 Standards／Spec 雙軸 review
  0 個 correctness finding。
  in-app browser control 仍未提供，因此 request-detail UI 只有 live asset/hash、
  DOM/accessibility contract 與測試證據，沒有新的 responsive rendered screenshot。
- 2026-08-06 晚間 Azure CLI read-only 對帳：2026-08-05 Cost Management 的 Fast
  Transcription 為 `1.8522222222` 小時（6,668 秒）、TWD `21.5883168`；舊 app
  ledger 是 raw 6,603.792 秒、逐 legacy row 向上取整 6,607 秒、USD `0.660379`，
  resource metrics 為 226 calls／225 success／1 client error。差 61 秒無法由舊
  job 聚合資料回推，因為歷史 row 沒有逐 request billed boundary／request ID。
- 2026-08-06 Cost Management 目前只 ingest 110 秒、TWD `0.356136`，但 app 已有
  raw 548.8 秒、USD `0.054880`，resource metrics 為 20/20 success，顯示帳單
  ingestion 尚未完成，不能拿當日未封帳列判定少記。Luna deployment 的同日
  resource-level request metrics 為 2026-08-05 286、2026-08-06 610，app 舊 ledger
  僅 8、4 個 summary rows；因該 resource metric 不是 app-exclusive 且歷史 ledger
  沒有 provider request ID，不能做逐 request 歷史配對。2026-08-05 同一 Luna
  resource 的 Cost Management 封帳列為 cached input 11.499136M／TWD
  37.2296027136、input 46.433639M／TWD 1503.335496264、output
  260.294702M／TWD 50563.807631712；反推 TWD/M 分別為 3.2376、32.376、
  194.256，恰好對應 catalog 的 USD 0.10、1.00、6.00/M 加該日 invoice 匯率。
  這確認 USD 單價正確，但不把 retail TWD 參考換算冒充 Azure invoice。新 request
  ledger 從本次 deployment 起保存 request identity、實際 provider/model、
  token/audio、成功失敗與 pricing status，Local Codex 標為 subscription，不混入
  Azure/API actual cost。
- 本次沒有觸發任何付費 provider call，沒有讀取、輸出、修改或輪替 key，也沒有
  commit、push、archive、tag 或 PR。mode 0600 rollback backup：
  `/tmp/ai-notetacker-predeploy-provider-audit.zRe46d.dump`，SHA-256
  `e00ab0056b9765cfbb1c130c678245af810d94766a02c805dbbe63682cf03034`。

### 2026-08-06 17:39 quota-only Azure summary fallback production deployment

- `local-codex` 維持唯一可選與可 claim 的 primary provider；Azure 不回到管理 UI
  或 policy。worker 只信 Codex app-server `account/rateLimits/read` 的結構化
  `rateLimitReachedType`，不比對錯誤字串。
- preflight 已耗盡會略過 doomed local turn；一旦 local turn 開始，後續失敗不再
  重新解讀為 quota。probe timeout／錯誤／malformed、登入、網路、schema、model
  或一般 timeout 都 fail closed，不觸發 Azure。
- Azure fallback 先以 active summary lease 在資料庫原子保留；job 即使 crash、lease
  expiry 或被重領，也不能做第二個 Azure request。terminal callback 帶 actual
  provider，control-plane 將成功或失敗 usage 記為 `azure-openai`。
- 若 process／host 在 Azure request 開始後、terminal callback 前硬中斷，reservation
  會保留並阻止重送，但 token usage 無法憑空補造；這個窄窗必須以 provider request
  log 人工核對，不能宣稱已完整 settlement。
- Azure endpoint/key 僅允許成對進入 summary-worker；control-plane、transcription
  worker、browser、Codex exec 與 quota probe 都不接收。沒有新增 OAuth token UI。
- targeted worker widest run 62/62；最後 handshake source 受影響的 21/21 與 causal
  wire-order file 10/10 通過。control-plane 相關五檔共 147 tests 通過，TypeScript
  build、Python compile、Compose isolation、37/37 strict OpenSpec 與雙軸 review 通過。
- 17:33 canonical `./scripts/deploy.sh up` 完成後，live gate 正確攔下舊 migration ID
  會跳過 reservation table；修成 `20260806-azure-summary-fallback-v1`、22 tests/build
  通過後，17:35 以同一 canonical helper scoped recreate control-plane。接著 live
  Codex 0.146.0 gate 發現 app-server 必須等待 initialize response；完成 causal
  regression 後於 17:39 scoped recreate summary-worker。兩個問題都在宣稱完成前修復。
- `/health=ok`；policy 為 `local-codex|gpt-5.6-luna`；migration 與
  `summary_fallback_reservations` table 已從真實 PostgreSQL 讀回，reservation、active
  summary job/lease 都是 0。control-plane、summary、transcription、recording worker
  全部 running、restart count 0，穩定兩分鐘 error count 0，worker 對 control-plane
  都是 HTTP 200；抽查的 5 個 control-plane／worker 改動檔 live/source SHA-256
  全部一致。
- summary-worker 使用 Codex CLI 0.146.0 且 `Logged in using ChatGPT`；結構化 live
  snapshot 為 `ok=true`、`reached=false`、2 buckets，production helper 1.225 秒回傳
  not exhausted。去識別 Local Codex synthetic summary 以 `gpt-5.6-luna`／`max`
  成功產生 title、summary、topic、action、decision；無殘留 Codex process。
- rollout 沒有繞過條件或觸發付費 Azure。部署後 Azure summary ledger row 與 fallback
  reservation 都是 0；只有 summary-worker 有三個 `AZURE_OPENAI_SUMMARY_*` 變數名稱。
  沒有讀取、輸出、修改、驗證或輪替 key，也沒有 commit、push、archive、tag 或 PR。
- mode 0600 rollback backup：`/tmp/ai-notetacker-predeploy-quota-fallback.43Qwt6.dump`，
  SHA-256 `348f7f864e6aa29b03d5f4d2da66663c58233552467063acf990810716698682`。

### 2026-08-06 Local Codex summary cutover

- 使用者核准把所有 active Azure Luna 摘要路由改為 `local-codex`，保留
  `gpt-5.6-luna`／`max`，沿用 host-managed Codex ChatGPT login；不新增 OAuth
  token 輸入、儲存或顯示。
- active provider catalog、管理 API、新工作 snapshot 與 summary claim 只允許
  `local-codex`；singleton policy 若仍是 `azure-openai`，啟動讀取時會正規化並
  持久化為 `local-codex`。已完成 job snapshot 與 ledger 不改寫。
- 16:26 部署的 summary worker 曾刪除 Azure Responses transport 與 summary
  endpoint/key/timeout；17:39 部署已只恢復內部 quota-only fallback。
  Azure Speech MAI 與 Azure OpenAI transcription fallback 不受影響。
- 每日 Azure Retail Prices refresh 只更新 MAI USD/TWD meter；上方後續 change 會
  讓 checked-in Luna catalog 同時支援歷史與新 fallback usage readback。

### 2026-08-06 16:26 Local Codex canonical production deployment

- deploy 前匿名化 DB preflight：非終態 Azure summary job、active summary lease、
  pending/generating summary 均為 0；舊 singleton policy 為
  `azure-openai|gpt-5.6-luna`。mode 0600 rollback backup 位於
  `/tmp/ai-notetacker-predeploy-local-codex.KEYnv9.dump`，SHA-256
  `d689ade6764de67f20c63822d956f6630cd80dabd2fd9a67a2728dd3df7c0ad4`。
- `./scripts/deploy.sh up` 以 base + ScreenApp canonical topology build/recreate
  完成，exit 0。control-plane、summary-worker、transcription-worker image 分別為
  `sha256:b4ac443b5268...`、`sha256:e4d14eeb430d...`、
  `sha256:c9642a35ba3a...`；全棧 running、restart count 0，既有 PostgreSQL／
  MinIO private ports 與 meeting-bot topology 保持不變。
- `/health` 為 `ok`；summary、transcription、recording worker 從容器內讀取
  control-plane 都是 HTTP 200。DB singleton 已持久化為
  `local-codex|gpt-5.6-luna`，active/pending summary 維持 0；migration ledger
  最新為 `20260805-runtime-hardening-v1`。
- control-plane 與 summary-worker effective env 的
  `AZURE_OPENAI_SUMMARY*` key count 都是 0；summary worker 顯示
  `Logged in using ChatGPT`。production image 以去識別 synthetic transcript 實際
  呼叫 `gpt-5.6-luna`／`max`，完整產生 title、summary、topic、follow-up、
  decision 與 open question；沒有寫入 DB 或 cloud usage ledger，結束後殘留 Codex
  process count 為 0。
- live `admin.html`、`admin.js`、`app.js`、`styles.css` 與 summary worker 兩個
  Python entrypoint 的 SHA-256 均逐檔等於工作樹；control-plane、summary-worker、
  transcription-worker 最近 10 分鐘 error count 為 0。recording-worker 只在
  recreate 視窗出現 12 行 transient connection error，部署完成後最近 60 秒為 0。
- 本次沒有讀取、輸出、修改或輪替任何 key，也沒有新增 OAuth token 輸入；沒有
  commit、push、archive、tag 或 pull request。

> 下方 2026-08-05 以前的 Azure Luna 內容是舊 primary route 的歷史部署／稽核
> 證據；目前只規劃在 summary-worker 內做 quota-only fallback，不恢復該 primary route。

### 2026-08-06 10:15 control-plane-only production deployment

- 使用者明確要求不處理 summary key 並繼續部署；本次沒有讀取、輸出或修改
  key，也沒有 provider 測試。部署來源是 branch `chore/summary-effort-max` 上尚未
  commit／push 的 7 檔 WIP，不能視為遠端 release 證據。
- 部署前 PostgreSQL 只有 86 個 completed 與 32 個 failed job，沒有非終態
  工作。以 canonical base + screenapp Compose 執行
  `./scripts/deploy.sh up --no-deps control-plane`，只 build/recreate
  control-plane；summary、transcription、recording worker 的 container ID 與
  restart count 均未改變。
- 新 control-plane image 為
  `sha256:21def8872380b06634b12556108512b3686b28db04982809bc15f806315d0d96`，
  container 為 `ddb50cdebf52...`，health 為 healthy、restart count 0；`/health`、
  dashboard 與 operator config 分別為 200，startup log 沒有錯誤。
- migration ledger 讀回 `20260805-runtime-hardening-v1`；PostgreSQL 與 MinIO
  仍只有 container-private 5432／9000 port，control-plane 沒有 host runtime
  mount。停止中的 `qwen3-asr` 是 Compose 明確定義的可選 `qwen` profile，模型
  cache 保留，不是 orphan。
- live `app.js` 與 `styles.css` SHA-256 均逐 byte 等於工作樹；production image
  讀回 Multer `2.2.0` 與 Nodemailer `9.0.4`。部署前相關測試 4 files、97 tests、
  control-plane TypeScript build、public JS syntax、Nodemailer JSON transport、
  `npm ci` audit 0 vulnerabilities 與 `git diff --check` 均通過。
- in-app browser connector 本次仍未提供，因此沒有新的 rendered screenshot
  證據；只確認 live HTTP、asset hash 與既有 renderer／CSS contract tests。

### 2026-08-05 18:34 canonical production deployment

- release source 與遠端 `main` 均為
  `3b6ac29409fed2e756a1af099030c60722210414`；部署前 PostgreSQL 只有
  86 個 completed 與 32 個 failed job，active summary lease 為 0。mode 0600
  PostgreSQL 備份保留於 `/tmp/ai-notetacker-predeploy-3b6ac29.dump`，SHA-256
  為 `bd710953b3c9cc3ae97cc7875152cc5dbb03a30526c5dc20beff976a84489561`。
- 使用者明確要求本次不處理 summary key 並正式部署；因此沒有讀取、輸出或
  修改 key，也沒有 provider 測試。`./scripts/deploy.sh up` 仍使用既有
  gitignored `.env` 完成 base + screenapp build/recreate，這項結果不構成 key
  已輪替或安全的證據。
- control-plane、summary-worker 與 transcription-worker 新 image 分別為
  `sha256:e6573a8a0b79...`、`sha256:8ec20f4e14cd...`、
  `sha256:df43e4bc4498...`；三者與其餘正式容器均為 running、restart count 0。
  recording-worker image 未變，Compose 保留既有容器。
- `/health` 為 `ok`；三個 worker 從容器內讀取 control-plane health 均為 200。
  recording-worker 在 control-plane recreate 窗口短暫出現 DNS／connection
  retry，control-plane healthy 後最近一分鐘無新錯誤。真實 migration ledger
  讀回 `20260805-runtime-hardening-v1`。
- summary-worker 實際讀回 `gpt-5.6-luna`、effort `max`、timeout `900`，endpoint
  與 key 只驗證為已設定；transcription-worker 讀回 `mai-transcribe-1.5`，且不含
  summary endpoint/key。PostgreSQL 與 MinIO 沒有 host published port，舊 Redis
  orphan 已移除。
- live `app.js`、`artifact-reader.js`、`styles.css` hash 均與 release source
  相同；真實 owner notes route 為 200，API 讀回 completed、逐字稿、摘要與
  structured summary。live CSS 保留 `min(72vh, 52rem)`／`overflow-y:auto` 且
  沒有 owner `max-height:none` override。Chrome 對 localhost 的 CDP 與獨立
  one-shot navigation 都 timeout，未產生新截圖，因此
  `refine-meeting-artifact-reader` task 4.3 仍未完成。
- PostgreSQL 目前有 98 筆 recording artifact、89 筆 transcript artifact、
  83 筆 summary artifact；3 筆 operator-hidden job 仍各保留 transcript／summary
  供 admin audit。production `npm audit --omit=dev` 另回報 0 critical、3 high、
  3 moderate、1 low；high 位於 `fast-xml-builder`、`multer`、`nodemailer`，本次
  未以未審查的自動 dependency rewrite 擴大部署。

### 2026-08-05 runtime／console scaffolding 部署前驗證紀錄

- 新 OpenSpec change `shrink-runtime-and-console-scaffolding` 與 GitHub issue
  `andys0919/AI_NoteTacker#7` 追蹤本次 audit follow-up；strict validation 通過。
- 既有 Python worker Dockerfile 已提供 `transcription`／`summary` targets；
  summary image 不含 Whisper、CUDA、FFmpeg、S3、OpenCC 或 npm，transcription
  image 不含 Node、npm 或 Codex。control-plane／recording-worker final images
  不再保留 TypeScript、Vitest、tsx 與 type packages。
- 本機 build 後 image size：summary `610,707,726` bytes（原
  `4,166,271,374`，-85.3%）、transcription `3,418,958,796`（原
  `4,166,255,792`，-17.9%）、control-plane `246,114,909`（原
  `342,578,336`，-28.2%）、recording-worker `227,157,245`（原
  `301,615,980`，-24.7%）；合計減少 `4,473,782,806` bytes（49.8%）。
- console 刪除 362 個被後方相同 selector／property／at-rule context 覆蓋的
  CSS declarations 與 73 個空 rules，共 622 行；body 與 admin rail 的
  `vh`／`dvh` progressive-enhancement fallback pairs 保持原順序。另刪除無
  runtime caller 的
  browser helpers／view-model fields／test-only coverage。CSS 檔案已與機械產生
  的精確刪除結果逐 byte 比對，相關 layout／share shell／helper/API tests 為
  8 files、66 tests PASS；review-loop fallback 修正後受影響的 layout tests 為
  1 file、6 tests PASS。
- `npm run build`、Python production Compose test、base／production／smoke
  Compose target／stage isolation assertions、修改過的 JS syntax、runtime probe
  argument parsing、dead-reference scan、worker image import／dependency assertions
  與 control-plane container health 均通過。
- 完整 diff 以 `5dff4d5` 為 fixed point 完成初始 Standards／Spec 雙軸 review；
  使用者要求的 post-push review loop 第 1 輪找到並修正 `vh`／`dvh` fallback
  與孤立 readiness 註解兩個 Low findings；第 2 輪 Standards／Spec 均為
  0 findings，review loop 終止。
- in-app browser control 本次不可用，因此改以本機 Chromium DevTools Protocol
  渲染並人工檢查 dashboard `1440x1200`／`390x844` 與 admin login
  `1440x1000`／`390x844`；四個畫面的標題、卡片、表單、按鈕、間距與響應式
  排版完整，document `scrollWidth` 等於 `clientWidth`，沒有水平 overflow。
- 只重建本機 image tags，沒有 recreate 或 deploy。現有四個 live app
  containers 仍使用舊 image IDs `6a4fe3cb31b9`、`0a82c67821ca`、
  `ec30ed8fff8d`、`07aaeee2b57d`。

### Done（截至 2026-07-31 的實作 checkpoint；非目前 WIP 驗證）

- 共用 `azure_openai_responses.py` 承接摘要 request/response/usage 契約；沒有
  active entrypoint 的舊潤稿與 diarization provider caller 已刪除，歷史 artifact
  與 ledger 欄位仍保留相容讀取／結算。
- Python transcription／summary workers 已加入摘要與 Azure transcription
  socket-operation timeout，以及這兩個 workers 對 control-plane
  GET／POST／heartbeat 的 timeout；Azure 摘要嚴格要求完整 topic-based
  schema，valid usage 即使伴隨 invalid summary 也會留在 failure callback。
- terminal callback 第一次傳送失敗時會精確重送一次，不會重做 provider call 或把成功改報失敗；轉錄中途失敗也保留先前成功 upload 的 audio usage。
- control-plane 已有 `punctuation` stage、nullable pricing、lease-token entry key、immutable idempotent append、scheduler-issued token history，以及 callback 先結算 usage、再以 active-token CAS 處理 lifecycle 的實作與測試；cloud terminal callback 不再接受 missing、never-issued 或共用 `legacy` lease key。
- pricing catalog 的 deployment model、pricing version、base model/version 與 meter source 必須非空，另須具備 SKU 或 service tier、USD、有效的 `YYYY-MM-DD` effective date，且所有 rate 都必須 finite、非負；SKU/service tier 必須恰有一個。production catalog 已加入驗證過的 Luna Global Standard 與 MAI Fast Transcription 費率。
- admin API/UI 對 transcription ledger 顯示 `audioMs`／秒數，不再把它錯顯示成 0 tokens。
- ledger、quota 與 API 仍以 USD 保存與結算；operator／admin 的費用與 quota
  統一以 TWD 顯示，admin 輸入的 TWD 額度在送出前轉回既有 USD API 精度。
  `未定價` 與 lower-bound 警告不因換算而消失。
- production compose override 不再把 `SUMMARY_MODEL` 硬改回舊模型；canonical production file set 仍是 base + screenapp。
- OpenSpec change `update-cloud-summary-azure-responses` 已補 proposal、design、tasks
  與三個 capability delta；此歷史 checkpoint 當時仍有 6.6、6.7、6.8 三個 gate，
  目前狀態以下方 OpenSpec 狀態段為準。
- OpenSpec change `use-qwen-primary-transcription` 已完成 provider、adapter、
  Compose profile 與盲比對契約；Qwen 現保留為明確啟用的可選方案，不是正式
  global default，也不阻塞 MAI worker 啟動。
- OpenSpec change `use-mai-luna-transcription-pipeline` 的程式、正式 worker
  部署、正確 HDD WAV 盲測、PLAUD 比較與 Standards／Spec 雙軸 review 均已
  完成；strict validation 通過，完整證據見該 change 的 `benchmark.md`。
- OpenSpec change `simplify-mai-transcription-pipeline` 已取代其中的 Luna
  逐字稿潤稿與 diarization runtime wiring；新工作只執行 MAI、確定性正體化
  與 Luna/max 摘要。
- completed job 內容改為按需載入的 `摘要`／`逐字稿` 分頁；摘要使用文章層級
  與可用章節目錄，逐字稿分開顯示時間與文字，正常閱讀面不顯示 Speaker 或
  raw-recognition evidence；owner 詳情頁的長逐字稿維持單一具名、可鍵盤操作的
  bounded scroll region，不再把整頁撐到數萬像素。歷史 flat summary 不需重新生成。
- Luna/max 摘要 prompt 改為 coverage-first：先覆蓋前／中／後段，再以內容
  衍生會議標題、主題與子主題，並分別收錄 grouped follow-up、決議、風險、
  待確認事項與有逐字稿依據的分析註記；相容的 key points／action items 由該
  hierarchy 推導，不再發第二次 model request。沒有加入 PLAUD 答案、HDD
  主題清單或 phrase list。
- owner 與 public reader 改用同一個 structured-summary renderer；章節、主題、
  子主題與 grouped follow-up 都使用固定 section key 或標題與內容共同衍生的
  語意錨點，同名但內容不同的項目仍有獨立網址，內容重排不會讓舊網址錯指其他
  段落；public URL 以
  `#<token>::<target-id>` 保留 bearer token 與深層位置。所有深層目標都可接收
  鍵盤焦點，桌機目錄預設展開且 sticky，沿用頁面捲動而不建立第二個 scrollbar；
  窄螢幕以原生 `details` 預設收合並跟隨 920px breakpoint 變化。owner 詳情頁
  直接使用會議標題作為唯一 `h1`，摘要由 `h2` 接續，工作 metadata 與分享操作
  收進摘要前的原生 `details`，避免管理卡片先把內容推到首屏以下。
  未來 Luna 摘要會在 transcript 明確支持時保留前置條件、正常流程、例外／復原、
  責任與跨主題依賴，不新增 schema 或第二次模型 request。

### 歷史 verification／deployment 觀察（有日期，不是目前 WIP proof）

以下項目是 2026-07-29 至 2026-07-31 當時保留的執行紀錄；除非在目前工作樹
重新執行，不能用來宣稱 2026-08-04 source、image、database 或 live runtime
已通過。它們在當時也不能自動關閉 `update-cloud-summary-azure-responses` 的 6.6、
6.7、6.8；目前狀態以下方 OpenSpec 狀態段為準。

- 2026-07-29 fresh transcription-worker full suite 為 148/148；最後 diarization
  retry／cancel／usage focused file 為 32/32。
- `npm run build:python` 與 `git diff --check` 通過。
- `openspec validate --all --strict --no-interactive` 為 29/29。
- 2026-07-30 focused worker tests 27/27、control-plane tests 78/78 與
  TypeScript build 通過；三個受影響服務已 rebuild/recreate，health 正常。
- canonical transcription-worker 的 Compose 與 runtime
  `diarization_configured=false`；live HDD job 仍保留 399 個歷史 speaker
  metadata，但 658/658 個 reader segment 輸出 0 個 speaker field 與 0 個
  matching speaker prefix。既有摘要 artifact 仍有 10 個匿名 Speaker label，
  operator/admin 呈現與 Markdown/TXT 匯出為 0；JSON evidence export 保留原始
  metadata。
- 同一 live HDD 逐字稿以新 coverage-first prompt 直接驗證 Luna/max 兩次，
  兩次都在 300 秒等 response header 時發生 read timeout，沒有 HTTP
  response、summary payload 或 usage；因此目前沒有新內容可聲稱優於 PLAUD，
  job 也未被改寫。
- 2026-07-30 simplified worker 映像已 rebuild/recreate：transcription worker
  解析為 `mai-transcribe-1.5`，不含 summary、punctuation、diarization config
  key；容器內 `zh-CN` 樣本輸出 `language=zh-Hant`、raw 簡體保留、display
  正體化。summary worker 解析為 `gpt-5.6-luna`／`max` 且 endpoint/key 已設定；
  兩個 worker 均在運行，control-plane health 為 `ok`，重建時 active job 為
  0。
- 2026-07-31 先前的 summary worker 已在 active summary job 為 0 時
  rebuild/recreate；production Compose 與容器內設定均讀回
  `gpt-5.6-luna`／`xhigh`，endpoint/key 已設定，restart count 為 0，
  control-plane health 為 `ok`。
- 2026-07-31 經使用者核准後，summary effort 已在 active summary job 為 0
  時改為 `high` 並只 rebuild/recreate summary worker；production Compose、
  容器內實際設定與映像內預設值均讀回 `high`。worker running、restart count
  為 0，endpoint/key 已設定，control-plane health 為 `ok`。
- 2026-07-31 初次 TWD 顯示部署已在 active job 為 0 時 rebuild/recreate
  control-plane；live currency asset 與本機 hash 相同，health 為 `ok`、
  restart count 為 0。operator 桌面與 390px 畫面顯示
  `NT$29.36（含未定價用量）`；admin 顯示 TWD 欄名、來源、日期與匯率。
  四個畫面均無 page-level overflow 或 browser error。
- 2026-07-31 全面 review 後的 focused frontend/API tests 25/25、summary prompt
  tests 6/6、TypeScript build、browser JS syntax、change-level strict OpenSpec
  validation 與 `git diff --check` 通過；其中真實執行 `share.js` 的測試會模擬
  token A 慢、token B 快，證明舊 response 不得覆蓋目前頁面，並在 API 回應前
  驗證 skip link 已保留當前 token。
- 2026-07-31 部署前 PostgreSQL `non_terminal=0`、
  `active_summary_leases=0`，因此只 rebuild/recreate control-plane；
  health 為 `ok`、restart count 為 0，四個 live assets 與本機 hash 相同。
  summary/transcription worker 未重建，container ID 維持
  `f63b1ee66cc0...`／`0f0bd527e2b6...`，restart count 都是 0。
- 2026-07-31 21:41:36（Asia/Taipei）同一 live owner reference job 已用部署中
  的 `gpt-5.6-luna`／`high` 與最新 coverage/dependency prompt 重產摘要；artifact
  為 6 主題、18 子主題、5 grouped follow-up、7 決議、6 風險、11 待確認與
  5 分析註記。這次 summary ledger 記錄 58,380 tokens，較前次 68,379 少約
  14.6%；provider 沒有可核價的完整 meter，故仍為 `unpriced`，不得宣稱精確
  summary 金額。重產前的 summary/state 已以 mode 0600 暫存於
  `/tmp/ai-notetacker-job_9d3ed71259f045feaabccd164e26dadc-summary-before-latest-20260731.json`
  （SHA-256 `1278838a32f20965d4bf2b5ddad7254e0c999ee19705f795e2013d8ad03499e3`）。
- 重產後 live owner page 的 36 個目錄連結為 7 章節、6 主題、18 子主題與
  5 grouped follow-up；瀏覽器 title 與唯一 H1 都是新會議標題，文章內不再重複
  title，工作資訊預設收合，頁面總費用只顯示
  `NT$27.34（含未定價用量）`。1440×900、375×812 與 844×390 實測皆為純黑
  視覺且 0 水平 overflow；grouped follow-up 深連結會更新 hash、聚焦並高亮
  正確目標，工作資訊的原生 summary 最小高度為 44px。
- 本次 content-first remediation 的 focused control-plane renderer/shell tests
  為 26/26、summary prompt tests 為 6/6，TypeScript build、change-level strict
  OpenSpec validation 與 scoped `git diff --check` 通過。control-plane 已以
  canonical base + screenapp Compose rebuild/recreate；image digest 為
  `sha256:1909c66934fb10d2b9b6f2ca21f1750872b3d3e146a53b81253dbde3dccaa707`，
  container `f01101001eac...` healthy，`/health` 為 `ok`。
- 重產前已建立真實 share 並以全新 Firefox recipient profile 驗證：
  public 有 6 章節、6 主題、21 子主題共 33 個連結；相較 owner 少一章是既有
  privacy allowlist 明確不公開 `analysisNotes`，不是渲染遺失。實測
  `#<token>::<target-id>` 重載後焦點正確、Bearer API 通過、token 不在 request
  URL 或 body、Speaker node 為 0，桌機與 390px 均 0 overflow。驗收後已撤銷
  分享（204），同一 token readback 為 generic
  `404 shared-meeting-unavailable`；沒有留下可用秘密網址。
- 前一版「既有 artifact 未重新呼叫 provider」狀態已由上述 2026-07-31 重產
  取代；重產只重做 summary stage，保留既有 transcript，不重跑轉錄。
- 2026-07-31 Azure retail pricing daily refresh 已只重建／recreate
  control-plane；啟動 log 在 listen 前讀回 Luna
  `1 / 0.1 / 1.25 / 6`、MAI `US$0.36/hour` 與 TWD
  `NT$11.4903/hour`／`1 USD = NT$31.9175`，接著才開放 port。容器
  `5b792c17af3a...` healthy、restart count 0，`/health` 為 `ok`；
  `/api/operator/config` 回傳同 rate、Azure source URL 與
  `verifiedAt=2026-07-31T09:13:10.899Z`，live currency asset hash 與本機一致。
  focused pricing/currency/API tests 45/45、browser JS syntax、TypeScript build
  與兩個 strict OpenSpec validation 通過；regression test 覆蓋原子更新與錯誤
  fallback，24 小時 interval 由啟動程式碼檢查，未假稱已等待 24 小時做
  wall-clock 觀察。
- 2026-07-31 23:22（Asia/Taipei）final correctness remediation 已完成：active
  owner detail polling 改讀完整 per-job snapshot；同名 topic／subtopic／grouped
  follow-up 以內容區分且重排後 ID 不交換；public 載入完成時讀取最新同 token
  target；桌機目錄使用頁面級 sticky 且沒有內層 scrollbar；owner 摘要由 `h1`
  接續 `h2`／`h3`／`h4`。對應行為測試 27/27、control-plane TypeScript build、
  `app.js`／`artifact-reader.js`／`share.js` syntax 與 change-level strict OpenSpec
  validation 通過。部署前 PostgreSQL `non_terminal=0`、
  `active_summary_leases=0`；只 rebuild/recreate control-plane，image digest 為
  `sha256:7361cd5d71d9af5a6f089a1d9b74c4399c390e0534102ca1da944057c85df1b1`，
  container `1ff6f2497229...` healthy、restart count 0，reference notes route 為
  200，live detail API 讀回 completed、transcript/summary/structured title 與 6
  topics。`app.js`、`artifact-reader.js`、`share.js`、`styles.css` 四個 live asset
  hash 均與本機一致；summary/transcription worker container ID 維持
  `f63b1ee66cc0...`／`0f0bd527e2b6...` 且 restart count 0。本次沒有宣稱新的互動
  截圖證據：所需 in-app browser connector 未提供，改以實際 renderer 行為測試、
  CSS contract、live asset hash 與既有同版面 viewport 證據驗證。
- 2026-07-30 已核對 live Azure deployment 為 `gpt-5.6-luna` model version `2026-07-09`、SKU `GlobalStandard`；Microsoft 官方公告與 Retail Prices API 均顯示短 context input USD 1.00/M、cached input USD 0.10/M、cache write USD 1.25/M、output USD 6.00/M。Southeast Asia MAI resource 的 Azure Consumption product 為 `Azure Speech - Fast Transcription`，其 exact regional meter 為 USD 0.36/hour。
- 2026-07-29 Qwen benchmark service 曾 healthy、零 restart；同一 worker
  image 對 9 組既有 Azure 歷史錄音盲跑 171.52 分鐘，9/9 成功、0
  marker leak、0 整稿 repetition failure；175/175 個 Qwen HTTP request 都
  沒有 `prompt`、phrase list、job glossary 或前段模型文字。詳見
  `docs/research/2026-07-29-qwen-vs-stored-azure.md`。
- 正確 HDD WAV 的官方 Qwen3-ASR API 94 個一分鐘 chunk 為 94/94 成功、
  110.482 provider-request 秒、p50 1.168 秒且無 gzip-ratio failure；它仍沒有
  自動恢復所有畫面可證的術語，詳見
  `docs/research/2026-07-29-full-asr-validation.md`。
- 下方「歷史 live 觀察」僅證明先前環境曾可呼叫，不算目前工作樹、目前映像或目前 DB 的驗收證據。

### Remaining（需外部權限／另行授權）

- 用至少三場未參與調參的新會議建立人工 reference，才能計算 Qwen、Azure
  與其他候選的 CER／專有名詞 accuracy；目前歷史比對只有 provider agreement
  與內容覆蓋證據。
- 取得 Azure subscription billing 權限後，核對實際 deployment identity 與 Cost Details `EffectivePrice`；公開 retail 價不等於此訂閱的實際成交價。
- 依 `design.md` 先 rebase／strict validate／archive
  `update-cloud-summary-azure-responses`，再 rebase／strict validate／archive
  `use-mai-luna-transcription-pipeline`，最後才 rebase／strict validate／archive
  `simplify-mai-transcription-pipeline`，確保移除 punctuation runtime 與 Luna/max
  契約不會被較舊 delta 加回；本次尚未執行任何 archive，task 6.8 仍未完成且
  archive 仍需另行授權。
- PostgreSQL repository 目前由 pg-mem integration 與受控 interleaving tests 驗證；startup schema 已改由 `schema_migrations`、transaction 與 advisory lock 序列化，但尚未在真實 PostgreSQL 上做 concurrent callback／claim 或 multi-instance rolling-migration 演練。
- migration 之後的 rollback 必須保留懂得 `pricing_status`／nullable `cost_usd` 的 control-plane 與目前 callback contract；上一版 control-plane 不能直接重新上線。目前仍沒有已演練的 schema-compatible full-code rollback image，此項保留為獨立 residual，不再誤稱為已改義的 task 6.7。
- Summary stale lease reclaim 已進入目前 live image 且既有 focused regressions 通過；
  本次沒有在 live DB 注入過期 lease，因此只確認 release 已部署，不宣稱完成真實
  stale-lease reclaim 演練。
- runtime-hardening 已 canonical deploy；port closure、migration ledger 與 orphan
  removal 已讀回。尚未實際觸發 private meeting-bot stop/restart，因此
  `add-runtime-operations-hardening` task 2.4 保持未完成。

## Codex PTY runtime 與設定契約

摘要必填／預設設定：

- `codex-pty-agent` 是 AI_NoteTacker 自己的 HTTP-only shared-runtime process；只用
  既有 bearer-authenticated `POST /api/prompt`，request cap 為 1 MiB。
- `AGENT_PROVIDER=codex-pty`、`CODEX_MODEL=gpt-5.6-luna`，project slot effort
  固定 `max`，`PROVIDER_FAILOVER_ENABLED=false`。
- `PTY_FRESH_SESSION_PER_TURN=true`、`MEMORY_FEATURES_ENABLED=false`、
  `USER_PROFILING_ENABLED=false`。
- cwd 固定 `/workspace/codex-pty-workdir`，對應 host 空目錄
  `/home/solomon/Andy/AI_NoteTacker/.codex-pty-workdir`。
- `CODEX_PTY_API_TOKEN` 是至少 32 bytes 的 dedicated secret，只存在 gitignored
  `.env` 與 service env；不得寫入文件、commit 或 log。
- `SUMMARY_TIMEOUT_SECONDS=900` 是 summary worker 對 Prompt API 的 wall-clock
  timeout；`CONTROL_PLANE_TIMEOUT_SECONDS=30` 是 worker 對 control-plane 的 HTTP
  timeout。

`ai_notetacker_codex_pty_home` 保存 agent 的 ChatGPT OAuth；
`codex_pty_agent_state` 保存其 session/runtime state；PTY namespace 固定
`ai-notetacker-codex-pty`。可與其他 bot 使用同一個 OAuth 帳號，但不得共用可寫
`CODEX_HOME`、PTY 或 session volume。`ai_notetacker_summary_codex_home` 只留給
summary worker 的 `account/rateLimits/read` weekly quota probe；summary generation
不得再啟動 `codex exec`。

逐字稿是未受信任資料。summary worker 建立既有 prompt 後只送往內部
`http://codex-pty-agent:3001/api/prompt`；Codex PTY 的 unrestricted surface 以 agent
container 為隔離邊界。Prompt API authentication、transport、timeout、PTY、quota、
schema 或不完整輸出一律沿 `summary-failed` 流程結束，heartbeat 不會永久續租。
摘要 JSON 仍必須完整包含 `title`、`summary`、`topics`、`follow_up_groups`、
`decisions`、`risks`、`open_questions` 與 `analysis_notes`；缺欄、錯型或空輸出均
不得儲存半成品。

canonical production 固定把 `AZURE_OPENAI_SUMMARY_ENDPOINT` 與
`AZURE_OPENAI_SUMMARY_API_KEY` 設為空，任何 Codex 失敗都不發 Azure request。
Azure Speech MAI 轉錄仍要求 `AZURE_SPEECH_MAI_ENDPOINT`、
`AZURE_SPEECH_MAI_API_KEY` 與 `AZURE_SPEECH_MAI_MODEL=mai-transcribe-1.5` 成組設定。

Codex PTY 摘要不建立 API actual-cost row，也不標示為 `$0` provider charge。
每個 MAI、Azure OpenAI、Qwen 或 Codex PTY 推論 request 仍先在
`provider_request_ledger` 建立 `started` row，再以同一 request ID 做 idempotent
finalization；Codex PTY 與 Qwen audit 分別標為 `subscription`／`self-hosted`，不
併入 Azure spend。歷史 Azure Luna ledger 沿用 checked-in pricing provenance；無
完整 meter 資訊時維持 `unpriced`，不捏造 `$0`。

## 歷史 Punctuation usage 與 lifecycle settlement

canonical transcription worker 已不再產生 `stage=punctuation`。為了讓既有
ledger、舊 callback 與歷史稽核資料仍可讀，以下契約保留相容：

- `inputTokens`、`cachedInputTokens`、`outputTokens`、`reasoningOutputTokens`、`totalTokens`
- `requestCount`、`acceptedChunkCount`、`fallbackChunkCount`、`unmeteredRequestCount`

raw fallback 不代表沒有 provider call；已花費的 token 不能因結果未採用而消失。成功、失敗、operator cancellation 或 superseded attempt 所回報的 usage 都應結算。

idempotency key 是 `(jobId, stage, leaseToken)`，實際 entry key 形狀例如：

```text
actual:<jobId>:punctuation:<leaseToken>
```

同 key、同 payload 重送時回傳既有 entry，不重複計數；同 key、不同 payload 是 conflict，不能覆寫第一次紀錄。不同 lease token 代表不同 provider attempt，即使舊 lease 已 superseded，仍各自記一次實際 usage。

cloud transcription／summary terminal callback 沒有 scheduler-issued lease token 時會被拒絕；control-plane 不再替它塞入共用的 `legacy` key。轉錄若前幾個 chunk 已成功上傳、後續 chunk 才失敗，failure callback 仍保留所有成功 provider upload 的 `audioMs`，不讓部分使用量消失。

事件順序必須是：

```text
驗證 callback 與 scheduler-issued token → append immutable usage → 檢查 cancelled/superseded/duplicate → 以 active lease token 原子比較並保存 lifecycle/artifact
```

每次 transcription／summary assignment 都必須把 lease token 追加到 job 的內部 issued-token history；cloud terminal callback 即使沒有 usage，也必須帶有曾由 scheduler 對該 job/stage 發出的 token。missing／never-issued token 在 ledger 與 lifecycle mutation 前拒絕。這些 history 不是 public API contract。

callback 若帶有必須結算的 provider usage，但 job 的 `quotaDayKey` 不是有效 `YYYY-MM-DD` 日曆日期，或 `pricingVersion` 缺少／空白，control-plane 必須明確回傳 settlement conflict，且不得寫 ledger、推進 lifecycle 或補造結算身分。

這不是跨 repository transaction。若 append 失敗，lifecycle 不得先保存；若 append 成功而後續 job save 失敗，callback retry 會命中相同 immutable entry，再完成 save。append 進行期間若 operator cancellation 或新 lease 已寫入，repository 的 atomic compare-and-save 必須失敗，保留已結算 usage、不得覆寫較新的 job state 或保存 stale artifact。單純先 re-read 再 unconditional save 不足以防止 race。

## 歷史 Azure Luna 費率與目前 pricing truth

截至 2026-07-31，live Azure deployment 已確認為 `gpt-5.6-luna`、model
version `2026-07-09`、SKU `GlobalStandard`。Microsoft 已公布短 context
Global Standard 費率，Retail Prices API 亦可查到 2026-07-01 生效的相同
meter：

| Meter | Rate |
|---|---:|
| Input | US$1.00 / 1M tokens |
| Cached input | US$0.10 / 1M tokens |
| Cache write | US$1.25 / 1M tokens |
| Output | US$6.00 / 1M tokens |

Southeast Asia 的 `mai-transcribe-1.5` 使用 Azure Speech Fast Transcription；
該訂閱 usage detail 的 meter ID
`e366297b-9194-5c2f-91f9-2b6472d890b3` 對應 US$0.36 / audio hour。

control-plane 現在只在開始 listen 前與每 24 小時查詢 MAI USD/TWD meter。
上述 Luna 費率留在 checked-in catalog，僅供歷史 Azure summary ledger 在讀取時
解析；不再對 live Azure Luna meter 做 refresh，也不能推導 Local Codex 訂閱成本。
MAI refresh 若遇到 HTTP 錯誤、10 秒 timeout、pagination、錯誤幣別／單位、缺
meter、跨區費率衝突或只有未來生效資料，會保留最後一份已驗證 catalog/TWD
reference 並寫 warning，不套用部分資料或零價。

同一 exact meter 於 2026-07-31 查詢 Azure Retail Prices API 的 TWD
參考零售價為 NT$11.4903 / audio hour，對應
`1 USD = NT$31.9175`，現在作為每日 API refresh 失敗時的 fallback。UI
統一使用 server 最新已驗證 reference 轉換目前 USD ledger／quota 金額；
後台顯示來源、匯率與日期。這是 Microsoft 提供的非 USD 預算參考價，不是
subscription invoice 的 `EffectivePrice`。

官方來源：

- [GPT-5.6 now available in Microsoft Foundry](https://azure.microsoft.com/en-us/blog/gpt-5-6-now-available-in-microsoft-foundry/)
- [MAI Transcribe](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-transcribe)
- [Prompt caching](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/prompt-caching)
- [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices)
- [Cost Details 欄位（`EffectivePrice`）](https://learn.microsoft.com/en-us/azure/cost-management-billing/automate/understand-usage-details-fields)

Responses 已知 token 計價公式是：

```text
(input - cached_input - cache_write) * input_rate
+ cached_input * cached_input_rate
+ cache_write * cache_write_rate
+ output * output_rate
```

`cached_tokens` 已包含在 input，`reasoning_tokens` 已包含在 output，兩者都不能再重複加總。
2026-07-30 live Azure Responses usage 沒有回傳另行計費的 cache-write token
數量；worker 現在會在 provider 回傳時保留該欄位並精確計價，缺少時仍不得補 0。
因此缺欄位的 Luna input/cached-input/output 只能作為已知 lower bound，完整
billed total 仍須標示含未定價用量。

Retail Prices API 可查到 `gpt-4o-transcribe` 公開 PAYG meter，但它們是
token 單位而不是目前程式舊用的 per-minute actual：

| Deployment type | Audio input | Text input | Text output |
|---|---:|---:|---:|
| Global | US$0.006 / 1K tokens | US$0.0025 / 1K tokens | US$0.01 / 1K tokens |
| Data Zone | US$0.0066 / 1K tokens | US$0.00275 / 1K tokens | US$0.011 / 1K tokens |

Regional meter 依 region 與 effective date 不同。以上仍只是公開 retail，不是此
subscription 的 `EffectivePrice`；而且目前 callback 沒有這三種 billed token
數量，所以不能拿表中的費率算出本 job 的 actual。

目前 ledger 與 reporting 的真實語義：

- immutable settlement row 不回填新價格；reporting 以保存的 exact model、
  pricing version 與 duration/token meter 在讀取時解析目前已知金額。
- 新 MAI usage 以每次成功 upload 各自向上取整到整秒後加總，再套用 Fast
  Transcription hourly meter；只要 retry／失敗 request 的 billed quantity 不確定，
  complete cost 維持 unpriced，成功 upload subtotal 只作為 lower bound。
- 歷史 MAI row 沒有保存每次 upload 邊界，reporting 只依 raw audio duration
  解析 USD 0.36/hour 的 known lower bound，仍保留 unpriced 且不修改 immutable ledger。
- 新工作通常只有 Azure 轉錄進入 cloud usage；Codex PTY summary 不建立 actual
  usage row。canonical production 的 Azure summary credential 為空，因此 quota
  exhaustion 不會發 Azure request；歷史 Luna summary／潤稿 row 仍依保存的
  provider/model 資料處理。
- `gpt-4o-transcribe-diarize` 舊 row 只有 `audioMs`，不足以重建三種 billed
  token charge，因此仍是 unpriced。
- 任一 actual entry 未完整定價時，完整 `totalCostUsd` 必須是 `null` 並設
  `hasUnpricedUsage=true`；UI 以「已知費用」顯示 lower bound 與
  `（含未定價用量）`，不再把可計算的金額整欄隱藏。
- daily quota 的 `remainingUsd` 只能扣除已知 lower bound 與仍在途 reservation；
  它不是 Azure 實際支出的 hard cap，仍須搭配 Azure Budget／Cost Management。

## 歷史 live 觀察（不是目前 proof）

先前操作紀錄曾觀察到：舊一版 worker 可對真實 Responses endpoint 完成一筆 synthetic summary、direct punctuation call 通過字詞保真 guard，當時容器也曾維持 healthy。該 synthetic job 與 ledger row 之後已刪除，而且目前工作樹又加入了 strict usage、timeout、settlement 與 nullable pricing 修改。

因此這些只能視為歷史方向性證據：

- 不能證明目前 source、目前 image 或下次 canonical deploy 可用。
- 不能證明 summary、punctuation、transcription 三個 ledger stage 已在 live DB 分開。
- 不能證明 lease duplicate／superseded callback 在 live 環境只結算一次。
- 沒有保留目前版本的完整 audio upload → transcription → punctuation → summary E2E artifact。

## Canonical Codex PTY deploy 與 rollback

production 一律使用 `docker-compose.yml` + `docker-compose.screenapp.yml`；不要執行
bare `docker compose up`，否則 recording worker 會掉回 stub。worker source baked
into image，所以 code 修改一定要 rebuild 並 recreate。Codex PTY agent 另外從
`CLAUDE_TELEGRAM_SOURCE_DIR` build shared runtime；不得改接 Report agent endpoint。

forward order：

1. 確認 gitignored `.env` 有至少 32 bytes 的 `CODEX_PTY_API_TOKEN`，
   `CLAUDE_TELEGRAM_SOURCE_DIR` 指向最新 shared runtime，且
   `.codex-pty-workdir` 存在、為空、可由 container 的 `bun` user 使用。
2. 確認 `ai_notetacker_codex_pty_home`、`ai_notetacker_summary_codex_home` 已有同一
   operator-selected ChatGPT OAuth；只比較或複製 credential file，不輸出 token。
3. render Compose，確認 agent 為 Codex PTY/Luna/max、fresh/no-memory/no-failover、
   1 MiB cap、bot-specific volumes；summary worker 指向內部 `/api/prompt`。Azure
   summary endpoint/key 必須是空字串。
4. 保存可回復的 DB backup 與前一版 image identifiers，執行 canonical deploy，
   再讀取 operator policy 確認
   `summary_provider='local-codex'` 已持久化。
5. 驗證 agent/worker health、兩個 Codex login、unauthenticated Prompt API 401、
   structured weekly quota、live structured summary、連續不同 native session ID、
   Report/AI concurrency 與近期錯誤日誌。

rollback：停止新 claim，保留 schema-aware control-plane，回復上一個已驗證的
Codex PTY image/config；不要把 generation 接回 `codex exec` 或 Report endpoint。
Azure summary credential 保持空白。

canonical 指令：

```bash
./scripts/deploy.sh up
./scripts/deploy.sh ps
```

## Historical security action

一次舊診斷輸出曾顯示 Azure summary key；該 credential 應視為 compromised，若
Azure resource 仍保留，應在另一個明確授權的 security action 撤銷或輪替。本次只
依使用者要求恢復 quota-only worker wiring，不讀取、輸出、修改、驗證或宣稱該 key
安全／有效，也不把值放入 issue、commit、測試 fixture 或驗證輸出。credential
rotation 與真實付費 provider call 仍是分離且未完成的 security action。

## OpenSpec 狀態

`use-local-codex-summaries` 的 implementation、static verification 與 canonical
live deployment tasks 已完成，selected/all strict validation 通過。archive 未獲
授權，且仍須處理下列 overlap/order；完成部署不等於自動 archive。被取代的
`update-cloud-summary-azure-responses` 6.6 已由 replacement live evidence 關閉；
6.7 schema-compatible rollback 演練與 6.8 archive/rebase 仍未完成。
`simplify-mai-transcription-pipeline` 3.5 只關閉被 Local Codex 取代的 Azure-primary
`max` 部署 gate；3.6 credential revoke/rotation 仍是未完成且需另行授權的 security
action。GitHub issue `andys0919/AI_NoteTacker#8` 追蹤本次契約與唯讀 UI 修正，並未
授權或執行 credential 操作、rollback 演練、archive、部署、commit 或 push。
`add-azure-summary-quota-fallback` 的 implementation、review、canonical deploy 與
live local-default evidence 已完成；archive 未獲授權，change 仍保持 unarchived。
`use-shared-codex-runtime` 的 implementation、focused verification、canonical live
deployment、auth rejection、fresh-session 與 Report/AI concurrent smoke 已完成；
change-level strict validation 通過，尚未 archive。
- `add-codex-transcript-summaries`、`add-cloud-usage-governance`、
  `update-cloud-summary-azure-responses`、`use-mai-luna-transcription-pipeline`、
  `simplify-mai-transcription-pipeline`、`add-admin-summary-model-switch` 與
  `add-operator-productivity-workflows` 對 summary／governance／punctuation
  requirement 有 archive-order overlap；CLI validation 不會偵測 MODIFIED 或
  REMOVED requirement 的語意覆蓋。必須先 rebase／strict validate／archive
  update-cloud，接著 rebase／strict validate／archive use-mai-luna，最後
  rebase／strict validate／archive simplify-mai，並再處理後續 summary MODIFIED
  deltas。task 6.8 在這些 rebase／revalidation 完成前維持未勾選。

2026-07-29 使用者曾另行授權當時 MAI/Luna 版本的 commit、push、部署與重啟；
2026-08-05 又明確授權目前 WIP commit、push `main` 與 canonical deploy。
2026-08-07 使用者另行授權本次 Codex PTY 變更與文件 commit、push。archive、tag
與 pull request 仍需另行授權。

`remove-unused-runtime-scaffolding` 另有固定的未來 archive 順序：
`extract-meeting-ai-pipeline-package` →
`externalize-meeting-ai-pipeline-dependency` →
`remove-unused-runtime-scaffolding`。每一步都必須重新 rebase／strict validate；
不可先 archive removal，否則後續舊 change 會把外部 package requirement 加回 published spec。
本次未執行任何 archive。

## 可重跑的 verification / deployment

目前 Codex PTY summary adapter 可在 repo root 重跑且不碰 live：

```bash
PYTHONPATH=workers/transcription-worker/src:workers/transcription-worker \
  python3 -m unittest tests.test_config tests.test_codex_transcript_summarizer \
  tests.test_summary_worker_loop tests.test_azure_openai_responses \
  tests.test_azure_openai_transcript_summarizer tests.test_production_compose
npm test --workspace @ai-notetacker/control-plane -- --run \
  test/admin-shell.test.ts test/admin-console-api.test.ts \
  test/cloud-usage-governance-api.test.ts test/cloud-usage-event-settlement-api.test.ts \
  test/recording-jobs-api.test.ts \
  test/summary-provider-catalog.test.ts
npm run build
git diff --check
openspec validate use-local-codex-summaries --strict --no-interactive
openspec validate add-azure-summary-quota-fallback --strict --no-interactive
openspec validate use-shared-codex-runtime --strict --no-interactive
openspec validate --all --strict --no-interactive
```

確認 production Compose 的 PTY/summary isolation，只輸出 boolean，不顯示 token
或 credential：

```bash
docker compose -f docker-compose.yml -f docker-compose.screenapp.yml config --format json \
  | jq -e '
      .services as $services
      | ($services["transcription-worker"].environment.AZURE_SPEECH_MAI_MODEL
          == "mai-transcribe-1.5")
        and ($services["transcription-worker"].environment
          | has("AZURE_OPENAI_SUMMARY_ENDPOINT") | not)
        and ($services["transcription-worker"].environment
          | has("AZURE_OPENAI_SUMMARY_API_KEY") | not)
        and ($services["codex-pty-agent"].environment.AGENT_PROVIDER
          == "codex-pty")
        and ($services["codex-pty-agent"].environment.CODEX_MODEL
          == "gpt-5.6-luna")
        and ($services["codex-pty-agent"].environment.PTY_FRESH_SESSION_PER_TURN
          == "true")
        and ($services["codex-pty-agent"].environment.MEMORY_FEATURES_ENABLED
          == "false")
        and ($services["codex-pty-agent"].environment.USER_PROFILING_ENABLED
          == "false")
        and ($services["codex-pty-agent"].environment.PROMPT_API_MAX_BODY_BYTES
          == "1048576")
        and ($services["summary-worker"].environment.CODEX_PTY_API_URL
          == "http://codex-pty-agent:3001/api/prompt")
        and ($services["summary-worker"].environment.SUMMARY_MODEL
          == "gpt-5.6-luna")
        and ($services["summary-worker"].environment.SUMMARY_REASONING_EFFORT
          == "max")
        and ($services["summary-worker"].environment.SUMMARY_TIMEOUT_SECONDS
          == "900")
        and ($services["summary-worker"].environment.CODEX_HOME == "/codex-home")
        and ($services["summary-worker"].environment.AZURE_OPENAI_SUMMARY_ENDPOINT
          | length == 0)
        and ($services["summary-worker"].environment.AZURE_OPENAI_SUMMARY_API_KEY
          | length == 0)
        and (($services["control-plane"].environment | keys
          | map(select(startswith("AZURE_OPENAI_SUMMARY"))) | length) == 0)
    '
```

canonical deployment 使用 `.env` 的 dedicated Prompt API secret；驗證時只確認
非空，不讀取或輸出值。Azure summary pair 必須維持空白：

```bash
./scripts/deploy.sh up
./scripts/deploy.sh ps
curl -fsS http://127.0.0.1:3000/health
docker compose -f docker-compose.yml -f docker-compose.screenapp.yml \
  logs --tail=200 control-plane transcription-worker codex-pty-agent summary-worker
docker compose -f docker-compose.yml -f docker-compose.screenapp.yml \
  exec -T codex-pty-agent codex login status
docker compose -f docker-compose.yml -f docker-compose.screenapp.yml \
  exec -T summary-worker codex login status
```

部署後先讀回 singleton policy，必須已持久化為 `local-codex`：

```sql
SELECT summary_provider, summary_model
FROM ai_processing_policy_settings
WHERE singleton_key = 'global';
```

若另跑一筆已去識別的 controlled summary，確認 job snapshot 為
`local-codex`／`gpt-5.6-luna`、由 Codex PTY 產生完整 structured summary，且
`cloud_usage_ledger` 沒有該 job 的 `stage='summary'` actual row。live evidence
必須遮蔽 transcript、summary、hostname、token、key 與使用者識別資料。

## 2026-08-05 runtime-hardening 本機驗證

- targeted control-plane：9 files、152 tests PASS，涵蓋 summary lease reclaim、active capacity、stale-token CAS、單筆／批次 artifact cleanup、cleanup failure、admin login throttling、HTTP meeting-bot control、migration ledger 與 runtime health。
- control-plane TypeScript build、`app.js`／meeting-bot control endpoint syntax、deploy shell syntax：PASS。
- production Compose render：PASS；rendered control-plane 沒有 Docker socket，PostgreSQL／MinIO 沒有 published ports，meeting-bot／PostgreSQL／MinIO 都使用 digest，meeting-bot control URL 為 private `http://meeting-bot:3001`。
- OpenSpec selected change 與 all-change strict：PASS；34/34。
- `git diff --check`：PASS。
- live deploy、真實 migration ledger readback、port closure 與 orphan removal：
  **PASS**；live meeting-bot stop/restart：**NOT RUN**。部署依使用者明確指示未
  等待 key rotation，沒有執行 provider call。

## 歷史最終驗證結果（不是目前 WIP proof）

以下為當時記錄，未在 2026-08-04 本次文件修正中重跑：

- `npm test`：PASS；control-plane 282、recording-worker 13、外部 Python package 2、transcription-worker 96，共 393 tests。
- `npm run build`：PASS；control-plane／recording-worker TypeScript build 與 Python compileall 均成功。
- `node --check`：PASS；`admin.js`、`app.js`、`dashboard-copy.js`、`governance-panel.js`。
- `git diff --check`：PASS；scoped hostname/provenance scan（排除 gitignored `.env`）無命中。
- canonical Compose boolean check：PASS（`true`），且未輸出 endpoint hostname 或 key。
- selected OpenSpec strict：PASS；all-change strict：22 passed、0 failed。
- Real PostgreSQL concurrency／rolling migration drill：**NOT RUN**；SQL 目前由 pg-mem integration 與受控 interleaving tests 覆蓋。
- Current-release reference summary regeneration：**RUN**；既有逐字稿的 summary
  stage 已完成並保留 usage、artifact、history 與重產前備份證據。完整新檔案
  audio upload → transcription → summary E2E 與 rollback drill：**NOT RUN**。
