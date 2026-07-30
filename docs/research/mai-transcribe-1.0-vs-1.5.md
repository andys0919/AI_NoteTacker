# MAI-Transcribe-1 與 1.5：價格、能力與同音訊比較

> 查核日期：2026-07-30
> 範圍：只使用 Microsoft／Azure 第一手資料；未呼叫付費 API。
> 名稱更正：官方模型 ID 是 `mai-transcribe-1`，沒有
> `mai-transcribe-1.0` 或 `MAT-1.0`。

## 結論

**不建議為了省錢從 1.5 改成 1。** Microsoft 目前將兩者都列為
**US$0.36／音訊小時**；1.5 的 Artificial Analysis WER 是 2.4%，1 是
2.6%，而且 1.5 多了更廣語言支援、entity/keyword biasing 與
`transcribeStyle`。官方資料沒有證據顯示 1 比 1.5 便宜或對這份中文技術會議
一樣準。

這次 1:33:36 音訊是 1.56 小時。按 Microsoft 公開的 US$0.36／小時計算，
模型轉錄約為 **US$0.5616**。系統顯示的 `$1.560123` 幾乎等於
`1.560123 小時 × US$1.00`，因此應先查本系統的 Speech 單價設定與 Azure
實際帳單 meter；**切換成 `mai-transcribe-1` 不會解決這個價差**。

來源：

- [Microsoft AI 的 1.5 模型頁與版本比較](https://microsoft.ai/models/mai-transcribe-1-5/)
- [Azure Speech 定價頁](https://azure.microsoft.com/en-us/pricing/details/speech/)

## 現有 Azure 訂閱的 meter 查核

2026-07-30 直接讀取目前登入的 Azure 訂閱與線上 worker，確認：

- worker 模型：`mai-transcribe-1.5`
- Azure 資源：`ai-itadmin2753ai646968161520-sea-mai15`
- 資源區域／SKU：`southeastasia`／`AIServices S0`
- Azure Consumption usage detail 的 product：
  `Azure Speech - Fast Transcription`
- 該筆 usage detail 的 meter ID：
  `e366297b-9194-5c2f-91f9-2b6472d890b3`
- 以相同 meter ID 與 `southeastasia` 查 Azure Retail Prices API，唯一結果為
  `Fast Transcription Speech To Text`、`1 Hour`、**US$0.36**。

因此這不是只根據宣傳頁推測：目前訂閱產生的實際 usage record 已指向
Fast Transcription meter，而該 meter 的官方 PAYG retail rate 確實是
US$0.36／音訊小時。Azure 當日 usage detail 尚未回填 `usageQuantity` 與
`pretaxCost`，所以最終發票成交價仍須等帳務資料完成。系統原先使用
US$1.00／小時顯示 MAI 成本，現已改依該實際 meter 使用 US$0.36／小時。

官方資料：

- [Azure Retail Prices API 文件](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices)
- [Azure Retail Prices API：Southeast Asia Fast Transcription meter](https://prices.azure.com/api/retail/prices?currencyCode=USD&$filter=meterId%20eq%20%27e366297b-9194-5c2f-91f9-2b6472d890b3%27%20and%20armRegionName%20eq%20%27southeastasia%27)

## 官方差異

| 項目 | `mai-transcribe-1` | `mai-transcribe-1.5` |
|---|---:|---:|
| 公開價格 | US$0.36／音訊小時 | US$0.36／音訊小時 |
| Artificial Analysis WER | 2.6% | 2.4% |
| 支援語言 | 25 | 43 |
| 中文 | 支援，但官方只列 `zh` 簡體中文 | 支援，但官方只列 `zh` 簡體中文 |
| Phrase list／entity biasing | 不支援 | 支援 |
| `transcribeStyle=verbatim` | 不支援 | 支援 |
| Speaker diarization | 不支援 | 不支援 |
| Prompt tuning | 不支援 | 不支援 |

來源：

- [MAI-Transcribe-1.5 模型頁](https://microsoft.ai/models/mai-transcribe-1-5/)
- [Azure MAI-Transcribe 文件](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-transcribe)
- [MAI-Transcribe-1 Model Card](https://microsoft.ai/pdf/MAI-Transcribe-1-Model-Card.pdf)

不能直接拿 FLEURS 的 `1 = 3.9%`、`1.5 = 4.9%` 判斷 1 比較準，因為兩個平均
值分別涵蓋 25 與 43 種語言，不是同一評測母體。相同 Artificial Analysis
評測則是 1.5 的 2.4% 略優於 1 的 2.6%。Microsoft 沒有公布這份臺灣中文、
中英混說、HDD 術語音訊的逐項結果，所以「差不多」只能用同一 WAV 實測回答。

## API 與區域限制

兩個模型都透過 Azure Speech LLM Speech API 的 `enhancedMode.model` 選擇，
官方範例使用：

```text
POST /speechtotext/transcriptions:transcribe?api-version=2025-10-15
```

目前官方區域表只列以下區域支援 `mai-transcribe`：

- `eastus`
- `northeurope`
- `southeastasia`
- `westus`

`eastus2` 支援一般 Fast Transcription，但**目前沒有列在 MAI-Transcribe
支援區域**。Speech key 也受區域限制，資源區域、endpoint 與 key 必須一致。

來源：

- [Azure MAI-Transcribe REST 範例](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-transcribe)
- [Azure Speech 支援區域](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/regions)
- [Azure Speech 2026 年 3 月 release notes](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/releasenotes)

## 能否公平使用同一音訊比較

可以，最小且公平的方式是只新增一次 `mai-transcribe-1` challenger：

1. 使用同一個正確 WAV、同一個 `southeastasia` Speech resource、同一
   `2025-10-15` API。
2. 兩次 request 除 `enhancedMode.model` 外完全相同。
3. 兩邊都不使用 phrase list、prompt 或 PLAUD／人工答案；也不要為 1.5 設
   `transcribeStyle`，因為 1 不支援。
4. 正體中文轉換在兩個 ASR 結果之後使用同一段程式，不能把簡繁差異算成模型
   辨識優劣。
5. 以人工從 WAV 標註、且事前凍結的代表性片段比較：
   - 中文 CER；
   - `舌片／條碼／MES／MVS／move in` 等術語正確率；
   - 漏字、幻覺與中英混說保留；
   - API 延遲與 Azure 實際 billed meter。

這個比較可以回答品質，但不需要用完整摘要重跑；摘要輸入相同逐字稿後續流程
即可。由於官方價格相同，A/B 的決策門檻應是「1 的品質是否更好」，不是成本。

## 不確定性與風險

- Microsoft AI 模型頁明列兩版皆 US$0.36／小時；Azure Speech 定價頁同時寫
  MAI 使用 Standard-Audio pricing。訂閱折扣、區域、preview 計費或實際 meter
  仍應以 Azure Cost Management／發票為準。
- 官方英文 Learn 頁仍列 1 與 1.5 為 supported；同一份文件的部分目前語系頁
  卻標示 `mai-transcribe-1` 將於 2026-08-20 deprecated。英文頁尚未同步顯示，
  因此不能把日期視為完全確認，但這已足以讓 1 不適合作為新的長期預設。
- 兩版都處於 MAI-Transcribe public preview，沒有 SLA，Microsoft 說不建議
  用於 production workload。
- 官方只標示 `zh` Chinese (simplified)，沒有 `zh-TW` 或臺灣技術會議品質
  保證。正體輸出仍須由本系統一致轉換與驗證。
