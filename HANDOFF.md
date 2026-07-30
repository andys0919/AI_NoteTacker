# Handoff — MAI 主轉錄、正體中文顯示、Luna max 摘要與誠實計價

_更新：2026-07-30（Asia/Taipei）_

## 目標與已核准架構

使用者已核准把 Azure Speech `mai-transcribe-1.5` 改為新工作的主轉錄，並於
2026-07-30 決定正式系統不再做 Speaker 分類；Qwen、Azure OpenAI
transcription 與 Whisper 保留為 operator 可選 fallback。轉寫 worker 不再
取得或使用 Luna 設定；Luna 只由摘要 worker 以
`gpt-5.6-luna`、`reasoning.effort=max` 呼叫。

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
   `reasoning.effort=max`；輸出、狀態或 usage 不完整時整次失敗，不儲存半成品。
5. Cloud usage：新工作只有 `transcription` 與 `summary` provider stage；
   歷史 `punctuation`／diarization ledger 仍保留相容。沒有官方可驗證費率時以
   `pricingStatus: unpriced`、`costUsd: null` 表示。

Responses endpoint 只記錄形狀，不記錄真實 hostname：

```text
https://<resource-host>/openai/v1/responses
```

## 目前 checkpoint

### Done（本地架構／程式／文件 review 已完成）

- 共用 `azure_openai_responses.py` 承接摘要 request/response/usage 契約；舊潤稿
  caller 保留為歷史相容程式，但 canonical worker 不再建立或呼叫它。
- Python transcription／summary workers 已加入摘要與 Azure transcription
  socket-operation timeout，以及這兩個 workers 對 control-plane
  GET／POST／heartbeat 的 timeout；Azure 摘要嚴格要求完整 topic-based
  schema，valid usage 即使伴隨 invalid summary 也會留在 failure callback。
- terminal callback 第一次傳送失敗時會精確重送一次，不會重做 provider call 或把成功改報失敗；轉錄中途失敗也保留先前成功 upload 的 audio usage。
- control-plane 已有 `punctuation` stage、nullable pricing、lease-token entry key、immutable idempotent append、scheduler-issued token history，以及 callback 先結算 usage、再以 active-token CAS 處理 lifecycle 的實作與測試；cloud terminal callback 不再接受 missing、never-issued 或共用 `legacy` lease key。
- pricing catalog 的 deployment model、pricing version、base model/version 與 meter source 必須非空，另須具備 SKU 或 service tier、USD、有效的 `YYYY-MM-DD` effective date，且所有 rate 都必須 finite、非負；SKU/service tier 必須恰有一個。production catalog 已加入驗證過的 Luna Global Standard 與 MAI Fast Transcription 費率。
- admin API/UI 對 transcription ledger 顯示 `audioMs`／秒數，不再把它錯顯示成 0 tokens。
- production compose override 不再把 `SUMMARY_MODEL` 硬改回舊模型；canonical production file set 仍是 base + screenapp。
- OpenSpec change `update-cloud-summary-azure-responses` 已補 proposal、design、tasks 與三個 capability delta。
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
  raw-recognition evidence。歷史 flat summary 不需重新生成。
- Luna/max 摘要 prompt 改為 coverage-first：先覆蓋前／中／後段，再以內容
  衍生主題，並分別收錄明確行動、決議、風險與待確認事項；沒有加入 PLAUD
  答案、HDD 主題清單或 phrase list。

### Verified（本 checkpoint 可重現）

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
- 依 `design.md` 完成 active-change archive order 的 rebase/revalidation，再另行授權 archive。
- PostgreSQL repository 目前由 pg-mem integration 與受控 interleaving tests 驗證；尚未在真實 PostgreSQL 上做 concurrent callback／claim 或 rolling-migration 演練。部署時必須先停止新 claim／routing、讓舊 control-plane 保持可接收既有 callback，drain 或明確處理所有舊 attempt，最後才停止全部舊 control-plane 並執行 active-token backfill。
- migration 之後的 rollback 必須保留懂得 `pricing_status`／nullable `cost_usd` 的 control-plane 與目前 callback contract；上一版 control-plane 不能直接重新上線。目前沒有已演練的 schema-compatible full-code rollback image，所以 task 6.7 仍未完成。
- **既有獨立 follow-up**：summary stale lease 目前沒有完整 reclaim path。worker 在 summary lease 期間崩潰時，`assignedSummaryWorkerId` 可能讓 job 無法被一般 summary claim 重新領取。此問題在本 change 之前已存在，不應假稱已由 Responses/usage 修改修好。

## Responses runtime 與設定契約

必填設定：

- `AZURE_OPENAI_SUMMARY_ENDPOINT`：HTTPS，path 必須是 `/openai/v1/responses`；不得接受 `chat/completions`。
- `AZURE_OPENAI_SUMMARY_API_KEY`：只從明確的 summary 設定讀取；不得 fallback 到 transcription key。
- `SUMMARY_MODEL=gpt-5.6-luna`。
- `SUMMARY_REASONING_EFFORT=max`。
- `AZURE_SPEECH_MAI_ENDPOINT`、`AZURE_SPEECH_MAI_API_KEY` 與
  `AZURE_SPEECH_MAI_MODEL=mai-transcribe-1.5` 必須成組設定。

可選設定／程式預設值：

- `AZURE_OPENAI_SUMMARY_TIMEOUT_SECONDS=300`。
- `AZURE_SPEECH_MAI_TIMEOUT_SECONDS=300`。
- `AZURE_OPENAI_TRANSCRIBE_TIMEOUT_SECONDS=300`。
- `CONTROL_PLANE_TIMEOUT_SECONDS=30`。

摘要 Luna request 的有效 body 為 `model`、`instructions`、`input`、
`reasoning: {"effort":"max"}`、`store: false`；以 `api-key` header 驗證。
轉寫 worker 不取得這組 endpoint/key。`store: false` 會關閉 Responses
application state／message history 儲存；它本身**不等於** Zero Data
Retention，也不控制
獨立的 abuse-monitoring retention，後者仍須依 Azure resource 的資料隱私設定核對。

每次 provider HTTP call 都設定 `urlopen` 的 connection/socket-operation
timeout：摘要 300 秒、Azure transcription upload 300 秒，Python
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
- Azure 摘要 JSON 必須完整包含非空字串 `summary`、`topics` 陣列，以及 `key_points`、`action_items`、`decisions`、`risks`、`open_questions` 五個 `string[]`。`topics` 可為空；每個 topic 必須有非空 `title`、`points`、`conclusion` 與 `confirmed|mixed|open` 狀態。其他空陣列合法，但缺欄、錯型或非字串元素都使該 attempt 失敗。若 usage 已合法解析，仍須在 failure callback 結算。

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

截至 2026-07-30，live Azure deployment 已確認為 `gpt-5.6-luna`、model
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

部署不是本 handoff 自動授權的動作。取得明確授權後，forward order 為：

1. 先停止新 claim／provider routing，但讓舊 control-plane 保持可接收已核發 attempt 的 callback；drain 或明確處理這些 attempt。此步驟只處理既有 attempt／callback，不得以已曝露的 key 啟動新的 provider call。
2. 在任何新 live provider call 或部署前輪替已曝露的 summary key；把新值只寫入 secret store／gitignored `.env`，不輸出、不提交。
3. 保存上一版 immutable release/image IDs、相容的安全 env snapshot 與 DB backup；snapshot 不放 repo。上一版 bundle 只可用於 migration 前的 abort，不能在新 schema 生效後直接恢復舊 control-plane。
4. 確認舊 attempt 已 drain／處理後，停止所有舊 control-plane instance，避免舊 binary 在 active-token backfill 後再核發沒有 history 的 lease；接著執行 additive schema migration，並部署可理解 `punctuation`、issued-token history、lease entry key、`pricing_status` 與 nullable `cost_usd` 的新 control-plane。已清除且沒有 active token／持久 history 的 pre-migration lease 無法事後重建。
5. 設定完整 Responses URL、rotated key、Luna model，以及摘要／transcription
   300 秒、Python worker control-plane 30 秒的 socket-operation timeout，但
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

## OpenSpec 狀態

`update-cloud-summary-azure-responses` 目前 **not archive-ready**，即使 selected-change strict validation 已通過，仍有以下 gate：

- implementation／local verification tasks 為 35/38；只剩 6.6 live deployment evidence、6.7 rollback drill、6.8 archive-order rebase/revalidation 未勾選。
- 尚未部署目前 release，也沒有 retained redacted live evidence 或 rollback drill。
- `add-codex-transcript-summaries`、`add-cloud-usage-governance`、`add-admin-summary-model-switch`、`add-operator-productivity-workflows` 對 summary/governance requirement 有 archive-order overlap；CLI validation 不會偵測 MODIFIED requirement 的語意覆蓋。必須依 `design.md` 的順序 rebase/revalidate 後才能 archive。

2026-07-29 使用者已另行明確授權這次 MAI/Luna 變更的 commit、push、部署與
重啟；未授權 archive、tag 或 pull request。

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
          == "max")
        and ($services["summary-worker"].environment.AZURE_OPENAI_SUMMARY_ENDPOINT
          | test("^https://[^/]+/openai/v1/responses/?$"))
        and (($services["summary-worker"].environment.AZURE_OPENAI_SUMMARY_API_KEY
          | length) > 0)
    '
```

只有在 key 已輪替且另有部署／付費測試授權後：

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

## 最終驗證結果

- `npm test`：PASS；control-plane 282、recording-worker 13、外部 Python package 2、transcription-worker 96，共 393 tests。
- `npm run build`：PASS；control-plane／recording-worker TypeScript build 與 Python compileall 均成功。
- `node --check`：PASS；`admin.js`、`app.js`、`dashboard-copy.js`、`governance-panel.js`。
- `git diff --check`：PASS；scoped hostname/provenance scan（排除 gitignored `.env`）無命中。
- canonical Compose boolean check：PASS（`true`），且未輸出 endpoint hostname 或 key。
- selected OpenSpec strict：PASS；all-change strict：22 passed、0 failed。
- Real PostgreSQL concurrency／rolling migration drill：**NOT RUN**；SQL 目前由 pg-mem integration 與受控 interleaving tests 覆蓋。
- Current-release live E2E / rollback drill：**NOT RUN**；未獲部署／付費測試授權，且暴露過的 key 必須先輪替。
