# Handoff — Azure Responses、潤稿 usage 與誠實計價

_更新：2026-07-15（Asia/Taipei）_

## 目標與已核准架構

使用者已核准方案 A：保留一個共用的 Azure Responses transport，讓「摘要」與「逐字稿標點潤稿」使用明確設定的 Responses endpoint/key；兩者可共用 credential，但不得從語音轉錄的 Azure endpoint/key 暗中推導或 fallback。

處理鏈如下：

1. 語音轉文字：`gpt-4o-transcribe`，既有 Azure transcription resource。
2. 標點潤稿：`gpt-5.6-luna`，Azure Responses API；仍是 best-effort，字詞保真檢查失敗時保留原文。
3. 摘要：`gpt-5.6-luna`，Azure Responses API；輸出、狀態或 usage 不完整時整次失敗，不儲存半成品。
4. Cloud usage：`transcription`、`punctuation`、`summary` 是三個獨立 stage；沒有官方可驗證費率時以 `pricingStatus: unpriced`、`costUsd: null` 表示，絕不拿其他模型費率或估算值冒充實際成本。

Responses endpoint 只記錄形狀，不記錄真實 hostname：

```text
https://<resource-host>/openai/v1/responses
```

## 目前 checkpoint

### Done（本地架構／程式／文件 review 已完成）

- 共用 `azure_openai_responses.py` 已承接摘要與潤稿 request/response/usage 契約。
- Python transcription／summary workers 已加入摘要、潤稿與 Azure transcription socket-operation timeout，以及這兩個 workers 對 control-plane GET／POST／heartbeat 的 timeout；Azure 摘要嚴格要求完整六欄 schema，valid usage 即使伴隨 invalid summary 也會留在 failure callback。
- terminal callback 第一次傳送失敗時會精確重送一次，不會重做 provider call 或把成功改報失敗；轉錄中途失敗也保留先前成功 upload 的 audio usage。
- control-plane 已有 `punctuation` stage、nullable pricing、lease-token entry key、immutable idempotent append、scheduler-issued token history，以及 callback 先結算 usage、再以 active-token CAS 處理 lifecycle 的實作與測試；cloud terminal callback 不再接受 missing、never-issued 或共用 `legacy` lease key。
- pricing catalog 的 deployment model、pricing version、base model/version 與 meter source 必須非空，另須具備 SKU 或 service tier、USD、有效的 `YYYY-MM-DD` effective date，且三種 rate 都必須 finite、非負；SKU/service tier 必須恰有一個。production Luna catalog 保持空白。
- admin API/UI 對 transcription ledger 顯示 `audioMs`／秒數，不再把它錯顯示成 0 tokens。
- production compose override 不再把 `SUMMARY_MODEL` 硬改回舊模型；canonical production file set 仍是 base + screenapp。
- OpenSpec change `update-cloud-summary-azure-responses` 已補 proposal、design、tasks 與三個 capability delta。

### Verified（本 checkpoint 可重現）

- `npm test` 通過：control-plane 34 files／282 tests、recording-worker 13 tests、外部 Python package 2 tests、transcription-worker 96 tests，共 393 tests。
- `npm run build`、四個 browser JS `node --check` 與 `git diff --check` 全部通過。
- selected OpenSpec strict validation 通過；`openspec validate --all --strict --no-interactive` 為 22/22。
- canonical production Compose 的安全 boolean 檢查為 `true`：兩個 worker 都解析成 Luna、正確 Responses URL shape 與非空 credential；驗證沒有輸出 hostname 或 key。
- 2026-07-15 查詢 Microsoft 官方 Azure OpenAI 定價頁與 Retail Prices API，沒有找到 `gpt-5.6-luna` / GPT-5.6 的公開 input、cached-input 或 output 單價。針對 Azure OpenAI GPT5 meter 的 `5.6` filter 回傳 `Count: 0`。
- 下方「歷史 live 觀察」僅證明先前環境曾可呼叫，不算目前工作樹、目前映像或目前 DB 的驗收證據。

### Remaining（需外部權限／另行授權）

- 先輪替已曝露的 `AZURE_OPENAI_SUMMARY_API_KEY`，之後才可做任何新的 live call。
- 需要另行部署／付費測試授權後，才部署目前工作樹並留下可稽核、已去識別的 live E2E 證據。
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

可選設定／程式預設值：

- `AZURE_OPENAI_PUNCTUATION_MODEL` 留空時沿用 `SUMMARY_MODEL`；若填值則只改潤稿 model，不改 endpoint/key。
- `AZURE_OPENAI_SUMMARY_TIMEOUT_SECONDS=300`。
- `AZURE_OPENAI_PUNCTUATION_TIMEOUT_SECONDS=30`。
- `AZURE_OPENAI_TRANSCRIBE_TIMEOUT_SECONDS=300`。
- `CONTROL_PLANE_TIMEOUT_SECONDS=30`。

每次 request 的有效 body 為 `model`、`instructions`、`input`、`store: false`；以 `api-key` header 驗證。`store: false` 會關閉 Responses application state／message history 儲存；它本身**不等於** Zero Data Retention，也不控制獨立的 abuse-monitoring retention，後者仍須依 Azure resource 的資料隱私設定核對。

每次 provider HTTP call 都只呼叫 Responses transport 一次，並設定 `urlopen` 的 connection/socket-operation timeout：摘要 300 秒，潤稿每個 chunk 30 秒；Azure transcription upload 預設 300 秒，Python transcription／summary workers 對 control-plane 的 GET／POST／heartbeat 預設 30 秒。這會限制個別阻塞 I/O 操作，並不是保證整段流程在該秒數內結束的 wall-clock deadline。transport **沒有 hidden provider retry**；要重新呼叫 Azure 必須由 scheduler 發出新的 lease，讓成本與 lifecycle 可依 attempt 追蹤。provider 已完成後，terminal control-plane callback 的第一次傳送若失敗，worker 只會把完全相同的 payload 重送一次，不會再呼叫 provider，也不會把成功改報成失敗。

Response 契約：

- 只有 `status == "completed"` 可接受；`incomplete`、`failed` 或缺少 status 都不能持久化為成功摘要。
- 依 `output[]` 原順序，只讀 `type == "message"` 的 `content[]`，再依原順序取每個字串型 `type == "output_text"`。
- 所有 fragment 直接 `"".join(parts)`，**不得自行插入換行或空白**；只在最後對完整字串 trim。
- `reasoning` 與其他 item type 一律跳過。
- 摘要輸出 trim 後必須非空。
- Azure 摘要 JSON 必須完整包含非空字串 `summary`，以及 `key_points`、`action_items`、`decisions`、`risks`、`open_questions` 五個 `string[]`；空陣列合法，但缺欄、錯型或非字串元素都使該 attempt 失敗。若 usage 已合法解析，仍須在 failure callback 結算。

完整 usage 必須包含非負整數：

```text
input_tokens
input_tokens_details.cached_tokens
output_tokens
output_tokens_details.reasoning_tokens
total_tokens
```

並要求 `total_tokens == input_tokens + output_tokens`、`cached_tokens <= input_tokens`、`reasoning_tokens <= output_tokens`。缺欄位、型別錯誤或不一致不能默認成 0。摘要因此失敗；潤稿則保留 raw chunk，若 provider usage 已成功讀到仍須保留該次 metered usage，否則增加 `unmeteredRequestCount`。

## Punctuation usage 與 lifecycle settlement

潤稿雖在 transcription worker 內執行，會計上仍是獨立 `stage=punctuation`。callback metadata 包含：

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

截至 2026-07-15，Microsoft 官方 model catalog 可確認 `gpt-5.6-luna`（model version/date `2026-07-09`）與 Responses 支援，但官方 Azure OpenAI pricing page 與 Retail Prices API 沒有提供這個 exact model/version/SKU 的公開 input/output PAYG／retail 費率。因此目前答案不是某組美元數字，而是：**Luna 公開 PAYG／retail exact rate 尚不可取得；此 subscription 的 actual rate 仍須由 Cost Details `EffectivePrice` 取得，不可推測。**

官方來源：

- [Azure Foundry models sold directly by Azure](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure)
- [Azure OpenAI Service pricing](https://azure.microsoft.com/en-us/pricing/details/azure-openai/)
- [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices)
- [Cost Details 欄位（`EffectivePrice`）](https://learn.microsoft.com/en-us/azure/cost-management-billing/automate/understand-usage-details-fields)
- [Azure AI Foundry cost management](https://learn.microsoft.com/en-us/azure/foundry/concepts/manage-costs)
- [Azure OpenAI data privacy](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/data-privacy)

可重跑的公開查核（不需 credential）：

```bash
curl -fsS --get 'https://prices.azure.com/api/retail/prices' \
  --data-urlencode "\$filter=contains(meterName, '5.6') and productName eq 'Azure OpenAI GPT5'" \
  | jq '{Count, Items}'
```

即使 Retail API 日後出現價格，它代表公開 retail/PAYG meter，不必然等於此 Azure subscription 的 negotiated actual。實際費率需先確認 deployment 的 base model、model version、SKU、service tier、region/currency 與 effective meter，再從 Cost Details 讀 `EffectivePrice`。只有 inference deployment name `gpt-5.6-luna` 不足以證明這些 identity；PTU 也不能換算成假定的 per-token actual rate。runtime 的 catalog validation 只能證明 row 形狀與數值合理，不能自行查出或證明 operator 填入的 deployment／meter identity；新增 row 前仍需人工核對 deployment metadata 與 Cost Details。

取得適當 Azure 權限後先查 deployment identity：

```bash
az cognitiveservices account deployment show \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_ACCOUNT_NAME" \
  --deployment-name "gpt-5.6-luna" \
  --query '{deployment:name,baseModel:properties.model.name,modelVersion:properties.model.version,sku:sku.name,serviceTier:properties.serviceTier,upgradePolicy:properties.versionUpgradeOption}'
```

Responses 日後若有 exact rate，計價公式是：

```text
(input - cached_input) * input_rate
+ cached_input * cached_input_rate
+ output * output_rate
```

`cached_tokens` 已包含在 input，`reasoning_tokens` 已包含在 output，兩者都不能再重複加總。

同日 Retail Prices API 可查到 `gpt-4o-transcribe` 公開 PAYG meter，但它們是
token 單位而不是目前程式舊用的 per-minute actual：

| Deployment type | Audio input | Text input | Text output |
|---|---:|---:|---:|
| Global | US$0.006 / 1K tokens | US$0.0025 / 1K tokens | US$0.01 / 1K tokens |
| Data Zone | US$0.0066 / 1K tokens | US$0.00275 / 1K tokens | US$0.011 / 1K tokens |

Regional meter 依 region 與 effective date 不同。以上仍只是公開 retail，不是此
subscription 的 `EffectivePrice`；而且目前 callback 沒有這三種 billed token
數量，所以不能拿表中的費率算出本 job 的 actual。

目前 ledger 的真實語義：

- Luna 摘要與 Luna 潤稿：保留 token meter，`pricingStatus=unpriced`、`costUsd=null`。
- `gpt-4o-transcribe`：Azure meter 是 token-based，但目前 worker callback 只帶 `audioMs`，不足以重建實際 token charge；因此 actual transcription 同樣是 `unpriced/null`。既有每分鐘常數只能用於 reservation estimate，不能標成 actual。
- 任一 actual entry 未定價時，完整 `totalCostUsd` 必須是 `null` 並設 `hasUnpricedUsage=true`。已定價項目的 `pricedCostUsd`／各 stage subtotal 只是 **known lower bound**，不可命名為完整 total；UI 要同時顯示未定價旗標。
- daily quota 的 `remainingUsd` 目前只能扣除已定價 lower bound 與仍在途的 reservation；當 Luna／transcription actual 都未定價時，它不是 Azure 實際支出的 hard cap，operator 必須搭配 Azure budget／Cost Management 控制風險。
- 無法證明 meter identity 的 legacy cost row 保留稽核資料，但轉成 `unpriced/null`；不可補造 token 或費率。

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
5. 設定完整 Responses URL、rotated key、Luna model，以及摘要／transcription 300 秒、潤稿／Python worker control-plane 30 秒的 socket-operation timeout，但先不要把尚未驗證的 routing 宣告完成。
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

本 handoff 不授權 commit、push 或 archive；需收到個別明確要求才執行。

## 可重跑的 verification / deployment

下列本地 verification 已於 2026-07-15 通過，可在 repo root 重跑且不碰 live：

```bash
git diff --check
python3 scripts/run_transcription_worker_tests.py
npm run test --workspace @ai-notetacker/control-plane
npm run build
openspec validate update-cloud-summary-azure-responses --strict --no-interactive
openspec validate --all --strict --no-interactive
```

確認 production compose 的 effective model/endpoint shape，但只輸出 boolean，不顯示 hostname 或 key：

```bash
docker compose -f docker-compose.yml -f docker-compose.screenapp.yml config --format json \
  | jq -e '
      .services as $services
      | ["transcription-worker", "summary-worker"]
      | map(
          . as $name
          | ($services[$name].environment.SUMMARY_MODEL == "gpt-5.6-luna")
            and ($services[$name].environment.AZURE_OPENAI_SUMMARY_ENDPOINT
              | test("^https://[^/]+/openai/v1/responses/?$"))
            and (($services[$name].environment.AZURE_OPENAI_SUMMARY_API_KEY | length) > 0)
        )
      | all
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
