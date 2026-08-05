# Handoff — MAI 主轉錄、正體中文顯示、Luna high 摘要與誠實計價

_更新：2026-08-05（Asia/Taipei）_

## 目標與已核准架構

使用者已核准把 Azure Speech `mai-transcribe-1.5` 改為新工作的主轉錄，並於
2026-07-30 決定正式系統不再做 Speaker 分類；Qwen、Azure OpenAI
transcription 與 Whisper 保留為 operator 可選 fallback。轉寫 worker 不再
取得或使用 Luna 設定；Luna 只由摘要 worker 以
`gpt-5.6-luna`、`reasoning.effort=high` 呼叫。

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
4. 摘要：獨立 `gpt-5.6-luna` Responses request、
   `reasoning.effort=high`、900 秒 socket-operation timeout；輸出、狀態、
   schema 或 usage 不完整時整次失敗，不儲存半成品。
5. Cloud usage：新工作只有 `transcription` 與 `summary` provider stage；
   歷史 `punctuation`／diarization ledger 仍保留相容。沒有官方可驗證費率時以
   `pricingStatus: unpriced`、`costUsd: null` 表示。

Responses endpoint 只記錄形狀，不記錄真實 hostname：

```text
https://<resource-host>/openai/v1/responses
```

## 目前 checkpoint

### 2026-08-05 runtime／console scaffolding follow-up（本機 image，未部署）

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
  與三個 capability delta，但目前仍有 6.6、6.7、6.8 三個 gate，尚未
  archive-ready。
- OpenSpec change `use-qwen-primary-transcription` 已完成 provider、adapter、
  Compose profile 與盲比對契約；Qwen 現保留為明確啟用的可選方案，不是正式
  global default，也不阻塞 MAI worker 啟動。
- OpenSpec change `use-mai-luna-transcription-pipeline` 的程式、正式 worker
  部署、正確 HDD WAV 盲測、PLAUD 比較與 Standards／Spec 雙軸 review 均已
  完成；strict validation 通過，完整證據見該 change 的 `benchmark.md`。
- OpenSpec change `simplify-mai-transcription-pipeline` 已取代其中的 Luna
  逐字稿潤稿與 diarization runtime wiring；新工作只執行 MAI、確定性正體化
  與 Luna/high 摘要。
- completed job 內容改為按需載入的 `摘要`／`逐字稿` 分頁；摘要使用文章層級
  與可用章節目錄，逐字稿分開顯示時間與文字，正常閱讀面不顯示 Speaker 或
  raw-recognition evidence。歷史 flat summary 不需重新生成。
- Luna/high 摘要 prompt 改為 coverage-first：先覆蓋前／中／後段，再以內容
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
已通過。它們也不會自動關閉 `update-cloud-summary-azure-responses` 的 6.6、
6.7、6.8。

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
  `simplify-mai-transcription-pipeline`，確保移除 punctuation runtime 與 Luna/high
  契約不會被較舊 delta 加回；本次尚未執行任何 archive，task 6.8 仍未完成且
  archive 仍需另行授權。
- PostgreSQL repository 目前由 pg-mem integration 與受控 interleaving tests 驗證；startup schema 已改由 `schema_migrations`、transaction 與 advisory lock 序列化，但尚未在真實 PostgreSQL 上做 concurrent callback／claim 或 multi-instance rolling-migration 演練。
- migration 之後的 rollback 必須保留懂得 `pricing_status`／nullable `cost_usd` 的 control-plane 與目前 callback contract；上一版 control-plane 不能直接重新上線。目前沒有已演練的 schema-compatible full-code rollback image，所以 task 6.7 仍未完成。
- Summary stale lease reclaim 已於 2026-08-05 本機 WIP 修正並通過 in-memory、PostgreSQL adapter 與 HTTP claim regression；尚未部署到 live container，所以不能把 live runtime 宣告為已修復。
- 2026-08-05 runtime-hardening WIP 尚未部署。現有 live PostgreSQL／MinIO 仍是歷史容器設定並暴露 host ports，舊 Redis orphan 仍存在；canonical deploy 會以 private-port Compose recreate 並 `--remove-orphans`，但必須先完成下方 summary key 輪替 gate。

## Responses runtime 與設定契約

必填設定：

- `AZURE_OPENAI_SUMMARY_ENDPOINT`：HTTPS，path 必須是 `/openai/v1/responses`；不得接受 `chat/completions`。
- `AZURE_OPENAI_SUMMARY_API_KEY`：只從明確的 summary 設定讀取；不得 fallback 到 transcription key。
- `SUMMARY_MODEL=gpt-5.6-luna`。
- `SUMMARY_REASONING_EFFORT=high`。
- `AZURE_SPEECH_MAI_ENDPOINT`、`AZURE_SPEECH_MAI_API_KEY` 與
  `AZURE_SPEECH_MAI_MODEL=mai-transcribe-1.5` 必須成組設定。

可選設定／程式預設值：

- `AZURE_OPENAI_SUMMARY_TIMEOUT_SECONDS=900`。
- `AZURE_SPEECH_MAI_TIMEOUT_SECONDS=300`。
- `AZURE_OPENAI_TRANSCRIBE_TIMEOUT_SECONDS=300`。
- `CONTROL_PLANE_TIMEOUT_SECONDS=30`。

摘要 Luna request 的有效 body 為 `model`、`instructions`、`input`、
`reasoning: {"effort":"high"}`、`store: false`；以 `api-key` header 驗證。
轉寫 worker 不取得這組 endpoint/key。`store: false` 會關閉 Responses
application state／message history 儲存；它本身**不等於** Zero Data
Retention，也不控制
獨立的 abuse-monitoring retention，後者仍須依 Azure resource 的資料隱私設定核對。

每次 provider HTTP call 都設定 `urlopen` 的 connection/socket-operation
timeout：摘要 900 秒、Azure transcription upload 300 秒，Python
transcription／summary workers 對 control-plane 的 GET／POST／heartbeat 30
秒。這會限制個別阻塞 I/O 操作，並不是保證整段流程在該秒數內結束的
wall-clock deadline。明確 retry 只有：MAI HTTP 400 會以完全相同的 request
重送一次；DNS／timeout／reset／broken connection 會以相同 request 在
2／10／30 秒後有限重送；正式配置不呼叫 speaker diarize 或 Luna 潤稿；
Luna 摘要 HTTP 400 會重送一次；
transcription 內容品質失敗最多重送兩次。內容品質失敗包括
可聽但稀疏的五分鐘 span，以及至少 20 秒、HTTP 200 但正規化文字 gzip ratio
大於 4.0 的高重複 span；後者從同一原音訊切成最多 30 秒重跑，保留 base
prompt／job glossary，但不帶前段生成文字。retry 都不改音訊或加入答案提示；
持續失敗時明確終止，不保存可疑文字。provider 已完成後，terminal
control-plane callback 的第一次傳送若失敗，worker 只會把完全相同的 payload
重送一次，不會再呼叫 provider，也不會把成功改報成失敗。

Response 契約：

- 只有 `status == "completed"` 可接受；`incomplete`、`failed` 或缺少 status 都不能持久化為成功摘要。
- 依 `output[]` 原順序，只讀 `type == "message"` 的 `content[]`，再依原順序取每個字串型 `type == "output_text"`。
- 所有 fragment 直接 `"".join(parts)`，**不得自行插入換行或空白**；只在最後對完整字串 trim。
- `reasoning` 與其他 item type 一律跳過。
- 摘要輸出 trim 後必須非空。
- Azure 摘要 JSON 必須完整包含非空字串 `title`、`summary`，以及
  `topics`、`follow_up_groups`、`decisions`、`risks`、`open_questions`、
  `analysis_notes` 陣列。每個 topic 必須有非空 `title`、
  `confirmed|mixed|open` 狀態、至少一個含非空 `title` 與 `details` 的 subtopic，
  以及非空 `conclusion`；每個 follow-up group 必須有非空 `title` 與 `items`。
  `key_points` 與 `action_items` 由 topics／follow-up groups 相容推導，不是
  provider 必填欄位。頂層分類陣列可為空，但缺欄、錯型或非法空值都使該
  attempt 失敗；若 usage 已合法解析，仍須在 failure callback 結算。

完整 usage 必須包含非負整數：

```text
input_tokens
input_tokens_details.cached_tokens
output_tokens
output_tokens_details.reasoning_tokens
total_tokens
```

並要求 `total_tokens == input_tokens + output_tokens`、`cached_tokens <= input_tokens`、`reasoning_tokens <= output_tokens`。缺欄位、型別錯誤或不一致不能默認成 0，摘要因此失敗。

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

## 官方費率查核與目前 pricing truth

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

control-plane 會在開始 listen 前查詢上述 exact Luna USD 與 MAI USD/TWD
Consumption meters，之後每 24 小時再查一次。Luna 必須同時取得 input、
cached input、cache write、output 四種同一生效日且跨回傳 region 費率一致的
short-context Global Standard rows；MAI 必須符合 exact meter ID、
`southeastasia`、SKU、unit、要求幣別與生效日。三組結果只會一起原子更新；
HTTP 錯誤、10 秒 timeout、pagination、錯誤幣別／單位、缺 meter、跨區費率
衝突或只有未來生效資料時，會保留最後一份已驗證 catalog/TWD reference 並寫
warning，不套用部分資料、零價或 OpenAI 直連價。程式內已查核值仍是
cold-start fallback；`/api/operator/config` 會提供目前 rate、來源與 refresh
timestamp，owner/admin 在顯示費用前套用，無效回應則保留 bundled fallback。

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
(input - cached_input) * input_rate
+ cached_input * cached_input_rate
+ cache_write * cache_write_rate
+ output * output_rate
```

`cached_tokens` 已包含在 input，`reasoning_tokens` 已包含在 output，兩者都不能再重複加總。
但 Azure Responses usage 目前不回傳另行計費的 cache-write token 數量。
因此 Luna 的 input/cached-input/output 可作為已知 lower bound，完整 billed total
仍須標示含未定價用量；不能把缺少的 cache-write meter 當成 0。

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
- MAI audio duration 可完整套用 Fast Transcription hourly meter；歷史上以
  S1 US$1.00/hour 儲存的列由 reporting read-time 依完整 audio duration
  重算，不修改 immutable ledger。
- 新工作只有 Luna 摘要可計算 input/cached-input/output lower bound，但
  cache-write quantity 不存在於 provider response，所以仍保留 unpriced
  flag；歷史 Luna 潤稿 row 同樣依舊資料處理。
- `gpt-4o-transcribe-diarize` 舊 row 只有 `audioMs`，不足以重建三種 billed
  token charge，因此仍是 unpriced。
- 任一 actual entry 未完整定價時，完整 `totalCostUsd` 必須是 `null` 並設
  `hasUnpricedUsage=true`；UI 顯示已知 lower bound 與
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

## Canonical deploy 與安全 rollback

production 一律使用 `docker-compose.yml` + `docker-compose.screenapp.yml`；不要執行 bare `docker compose up`，否則 recording worker 會掉回 stub。worker source baked into image，所以 code 修改一定要 rebuild 並 recreate。

2026-08-05 使用者已明確授權本次 commit、push `main` 與 canonical deploy；
archive、tag 與 pull request 仍未授權。這項部署授權不會略過下方 summary key
輪替安全 gate。完成輪替後的 forward order 為：

1. 先停止新 claim／provider routing，但讓舊 control-plane 保持可接收已核發 attempt 的 callback；drain 或明確處理這些 attempt。此步驟只處理既有 attempt／callback，不得以已曝露的 key 啟動新的 provider call。
2. 在任何新 live provider call 或部署前輪替已曝露的 summary key；把新值只寫入 secret store／gitignored `.env`，不輸出、不提交。
3. 保存上一版 immutable release/image IDs、相容的安全 env snapshot 與 DB backup；snapshot 不放 repo。上一版 bundle 只可用於 migration 前的 abort，不能在新 schema 生效後直接恢復舊 control-plane。
4. 確認舊 attempt 已 drain／處理後，啟動一個新 control-plane；它會在 transaction-scoped advisory lock 下執行尚未記錄的 additive migration，並把版本寫入 `schema_migrations`。確認版本、health 與 callback compatibility 後才替換其餘 replica／worker。
5. 設定完整 Responses URL、rotated key、Luna model，以及摘要 900 秒、
   transcription 300 秒、Python worker control-plane 30 秒的 socket-operation timeout，但
   先不要把尚未驗證的 routing 宣告完成。
6. 用同一個 release bundle rebuild/recreate transcription-worker 與 summary-worker；禁止把 chat endpoint 與 Responses caller 混搭。
7. compatibility/health 通過後才切換 runtime policy，接著執行已去識別的 live flow 並保留 ledger evidence。

canonical 指令：

```bash
./scripts/deploy.sh up
./scripts/deploy.sh ps
```

rollback 有明確的 schema compatibility floor：

- **migration 前 abort**：若新 schema 尚未生效，可停止 rollout，從保存的 immutable release 與相容 env snapshot 恢復上一版完整 bundle。
- **migration 後 feature rollback**：停止新 claim，drain／明確處理 in-flight lease，將 summary、punctuation 與 cloud transcription 切回相容的 local／disabled policy；保留目前 schema-aware control-plane 與目前 worker images，並使用 canonical Compose 驗證 health。
- **migration 後 full-code rollback**：只有另行建立並演練過、能寫入 `pricing_status`／nullable `cost_usd`、理解 issued-token history 且符合目前 callback schema 的 compatibility image 才可部署。目前不存在這項已驗證證據，因此不能直接恢復上一版 control-plane 或舊 worker。
- additive DB columns 與既有 ledger entry 保留，不刪除、不改寫。

舊 control-plane 的 INSERT 不含 NOT NULL `pricing_status`，而且會把 nullable cost 誤讀成 0，所以 migration 後禁止上線。舊 chat endpoint 只能隨 migration 前 abort 的舊 bundle 一起恢復；絕不能交給 Responses caller。新 Responses endpoint 也不能交給只會送 chat body 的舊 worker。

## Security action

一次診斷輸出曾顯示真實 `AZURE_OPENAI_SUMMARY_API_KEY`。即使該值未寫入本文件，也必須視為 compromised：**在任何下一次 live call 或部署前於 Azure 輪替／撤銷舊 key**，更新 secret store／gitignored `.env`，重建受影響 worker，並檢查 shell history、CI artifact 與協作紀錄是否另有副本。不得在 issue、commit、測試 fixture 或驗證輸出中貼出新 key。

2026-08-05 尚未取得已輪替證據，因此本次 runtime-hardening 只完成本機實作與驗證，未執行正式 deploy。這是安全 gate，不是測試或 Compose 失敗。

## OpenSpec 狀態

`update-cloud-summary-azure-responses` 目前 **not archive-ready**，即使 selected-change strict validation 已通過，仍有以下 gate：

- tasks 為 42/45；只剩 6.6 current-release durable live evidence、6.7 rollback
  drill、6.8 archive-order rebase/revalidation 未勾選。
- 尚未部署目前 WIP，也沒有可關閉 6.6 的 current-release retained redacted
  end-to-end evidence 或可關閉 6.7 的 rollback drill；上方 2026-07-29 至
  2026-07-31 部署紀錄只代表當時版本。
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
archive、tag 與 pull request 仍需另行授權。

`remove-unused-runtime-scaffolding` 另有固定的未來 archive 順序：
`extract-meeting-ai-pipeline-package` →
`externalize-meeting-ai-pipeline-dependency` →
`remove-unused-runtime-scaffolding`。每一步都必須重新 rebase／strict validate；
不可先 archive removal，否則後續舊 change 會把外部 package requirement 加回 published spec。
本次未執行任何 archive。

## 可重跑的 verification / deployment

下列本地 verification 已於 2026-07-29 通過，可在 repo root 重跑且不碰 live：

```bash
git diff --check
npm run test:python
npm run test --workspace @ai-notetacker/control-plane
npm run build
openspec validate update-cloud-summary-azure-responses --strict --no-interactive
openspec validate --all --strict --no-interactive
```

確認 production compose 的 stage isolation，但只輸出 boolean，不顯示
hostname 或 key：

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
        and ($services["summary-worker"].environment.SUMMARY_MODEL
          == "gpt-5.6-luna")
        and ($services["summary-worker"].environment.SUMMARY_REASONING_EFFORT
          == "high")
        and ($services["summary-worker"].environment.AZURE_OPENAI_SUMMARY_ENDPOINT
          | test("^https://[^/]+/openai/v1/responses/?$"))
        and (($services["summary-worker"].environment.AZURE_OPENAI_SUMMARY_API_KEY
          | length) > 0)
    '
```

只有在 key 已輪替後；目前已有部署授權，但付費 provider 測試仍需另行授權：

```bash
./scripts/deploy.sh up
./scripts/deploy.sh ps
curl -fsS http://127.0.0.1:3000/health
docker compose -f docker-compose.yml -f docker-compose.screenapp.yml \
  logs --tail=200 control-plane transcription-worker summary-worker
```

再用一個已去識別的測試音檔跑完整 flow，保留 job id，並在 DB 確認三個 stage、nullable price 與 entry-key 唯一性：

```sql
SELECT
  stage,
  md5(entry_key) AS entry_key_hash,
  provider,
  model,
  pricing_status,
  cost_usd,
  usage_quantity,
  usage_unit,
  detail
FROM cloud_usage_ledger
WHERE job_id = '<redacted-test-job-id>'
  AND entry_type = 'actual'
ORDER BY created_at ASC;

SELECT
  stage,
  COUNT(*) AS attempt_count,
  COUNT(DISTINCT entry_key) AS distinct_entry_keys
FROM cloud_usage_ledger
WHERE job_id = '<redacted-test-job-id>'
  AND entry_type = 'actual'
GROUP BY stage
ORDER BY stage;
```

live evidence 必須遮蔽 transcript、summary、hostname、key 與使用者識別資料；保留 stage/model/token counts、lease-key hash、pricing status、null cost 與重送前後 row count 即可。

## 2026-08-05 runtime-hardening 本機驗證

- targeted control-plane：9 files、152 tests PASS，涵蓋 summary lease reclaim、active capacity、stale-token CAS、單筆／批次 artifact cleanup、cleanup failure、admin login throttling、HTTP meeting-bot control、migration ledger 與 runtime health。
- control-plane TypeScript build、`app.js`／meeting-bot control endpoint syntax、deploy shell syntax：PASS。
- production Compose render：PASS；rendered control-plane 沒有 Docker socket，PostgreSQL／MinIO 沒有 published ports，meeting-bot／PostgreSQL／MinIO 都使用 digest，meeting-bot control URL 為 private `http://meeting-bot:3001`。
- OpenSpec selected change 與 all-change strict：PASS；34/34。
- `git diff --check`：PASS。
- live deploy、真實 migration ledger readback、live meeting-bot stop、port closure 與 orphan removal：**NOT RUN**，受上方 key rotation gate 阻擋。

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
