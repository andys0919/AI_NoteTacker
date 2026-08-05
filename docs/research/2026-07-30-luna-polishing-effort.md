# Luna 逐字稿標點／潤稿 effort 研究

> 研究日期：2026-07-30
> 範圍：官方模型指引、目前專案 benchmark，以及可借鏡的 GitHub 專案。
> 本次只做文件研究；未執行會產生費用的 A/B，也未修改程式或部署設定。

## 結論

現行「短分塊逐字稿標點／潤稿」不應預設使用 `max`。建議：

| 工作 | 建議 effort | 理由 |
|---|---:|---|
| 標點／潤稿 | `low` | 屬於受限的短文改寫；官方將 `low` 定位為兼顧品質、延遲與成本的輕量推理。 |
| 標點／潤稿 A/B 基準 | `none` | GPT-5.6 支援 `none`；可作最低成本與延遲基準，但需用真實會議語料確認術語與破碎語境品質。 |
| 破碎語境的例外候選 | `medium` | 只有代表性評測證明 `low` 不足時才提高，不應先預設。 |
| 摘要 | 暫維持 `max` | 長篇摘要涉及跨段整合、分類、遺漏檢查與判斷，而且目前只有一次請求；本研究沒有證據支持同時下調。 |

不要使用 `minimal`：Azure 官方說明中，GPT-5.1 以上不支援 `minimal`。本案 GPT-5.6 Luna 應比較 `none`、`low`，而不是 `minimal`。

## 官方指引

### OpenAI

OpenAI 的 [reasoning effort 指引](https://developers.openai.com/api/docs/guides/reasoning#reasoning-effort) 將 GPT-5.6 可用層級列為 `none`、`low`、`medium`、`high`、`xhigh`、`max`，並明確指出較低 effort 可降低延遲與 token 使用量。

[模型選擇指引](https://developers.openai.com/api/docs/guides/model-guidance?model=gpt-5.6-luna) 的核心原則是以代表性任務比較品質與成本，不應假設最高 effort 永遠是最佳取捨。[部署檢查表的 reasoning effort 指引](https://developers.openai.com/api/docs/guides/deployment-checklist#set-up-reasoningeffort) 建議對簡單、受限的 rewrite 先使用 `low`；`xhigh`／`max` 只應在代表性 eval 證明邊際品質提升值得成本時採用。

這與本案相符：標點／潤稿 prompt 是短分塊、受限制的文字改寫，不是長鏈規劃或高價值複雜推理。

### Azure OpenAI

Azure 的 [reasoning models 使用說明](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/reasoning) 指出：

- GPT-5.6 可使用 `none`；不產生 reasoning token 可提高速度。
- `minimal` 不支援 GPT-5.1 以上模型。
- `max` 僅適用 GPT-5.6 且需使用 Responses API。

Azure 支援 `max` 只代表 API 能接受，不代表它適合每一種工作。對本案應由 eval 決定是否升級，而不是因為可用就預設最大值。

## 本專案的成本證據

現有 [MAI + Luna benchmark](../../openspec/changes/use-mai-luna-transcription-pipeline/benchmark.md) 已提供直接證據：

| 指標 | 實測 |
|---|---:|
| Luna/max 潤稿請求 | 188 |
| 總 tokens | 690,489 |
| reasoning-output tokens | 618,468 |
| 摘要請求 | 1 |
| 摘要 reasoning-completion tokens | 30,203 |

潤稿的 reasoning tokens 約占其總 tokens 的 **89.57%**（618,468 ÷ 690,489）。188 個小型 `max` 請求消耗的 reasoning tokens，遠高於一次完整摘要。這已足以證明目前預設的成本結構失衡；但尚未證明 `low` 或 `none` 的實際品質，因此仍需後續盲測。

## DeepSRT roadmap 可借鏡什麼

[DeepSRT roadmap](https://github.com/DeepSRT/roadmap) 不是可直接抄用的 ASR 或 Luna 實作：

- roadmap 說明產品本體為 proprietary，沒有公開核心原始碼。
- 來源是 YouTube 已存在的 CC 字幕，不是從音訊做 ASR。
- 主要 AI 模型是 Google Gemini，不是 Azure OpenAI Luna。

因此它不能證明 Luna 應使用哪個 effort，也不能拿來驗證中文 ASR 術語修正。可借鏡的只有資料分塊與韌性設計：

| Roadmap 項目 | 可借鏡模式 | 適用本案 |
|---|---|---|
| [#12](https://github.com/DeepSRT/roadmap/issues/12) | 10-block batch 與 N+1 預取 | 減少小請求數，並讓下一批處理與目前批次重疊。 |
| [#62](https://github.com/DeepSRT/roadmap/issues/62)、[#64](https://github.com/DeepSRT/roadmap/pull/64) | 以句界切分，目標約 30–200 字元，切分失敗時 fallback | 比固定字數硬切更能保留語境，但需以本案中文會議資料驗證。 |
| [#69](https://github.com/DeepSRT/roadmap/pull/69) | 動態語言 prompt，並要求輸入與輸出 block 數一致 | 可減少跨語言誤改，也方便結果回填原時間區塊。 |
| [#2](https://github.com/DeepSRT/roadmap/issues/2) | retry、backoff 與 fallback | 可處理暫時性 API 或內容失敗，避免整份工作中斷。 |

以上是 maintainer／roadmap 文件的設計宣稱，不是可審查核心原始碼後得到的結論。若採用，只能視為待本案 eval 驗證的候選模式。

## 其他 GitHub 對照

### MacParakeet

[moona3k/macparakeet](https://github.com/moona3k/macparakeet) 採用較清楚的責任分離：

- 原始轉錄與清理後文字分開保存／呈現。
- AI formatter 是選配功能，不是 ASR 結果唯一真相。
- 核心語音辨識可在沒有雲端 LLM 的情況下完成；只有使用者選擇摘要、聊天或 formatter 時才送出文字。

本案應延續相同原則：保留不可變的 `rawText` 作證據，`displayText` 才接受 Luna 潤稿。這能在取消過度保守的內容 gate 時，仍保有回查能力。

### Qwen3-ASR context

[Qwen3-ASR 官方 repository](https://github.com/QwenLM/Qwen3-ASR) 提供長音訊、batch、streaming 與語言指定能力。其生態系也顯示 context／prompt 可輕度偏向技術詞與領域語境；例如 [antirez/qwen-asr](https://github.com/antirez/qwen-asr) 的 `--prompt` 說明明確表示它是機率偏向，而不是強制答案。

這與本案的通用解法一致：

1. ASR 階段只提供不含答案的領域／語言 context。
2. 保留原始轉錄。
3. 另做可選的顯示潤稿。
4. 不把 PLAUD 答案或測試集正解回填 prompt。

context 有助於技術詞，但不能取代同一 WAV 的盲測，也不能保證修復所有錯聽。

## 建議的下一個最小驗證

先不要改 summary。只對標點／潤稿做同一批代表性片段的盲測：

1. 固定模型、prompt、分塊與輸入，只比較 `none`、`low`、現行 `max`。
2. 不使用 PLAUD 答案、人工正解或會議特定 phrase list 作輸入。
3. 比較術語正確率、數字／專名誤改、幻覺、漏字、延遲、request 數、input/output/reasoning tokens 與成本。
4. 若 `low` 與 `max` 品質相當，正式改為 `low`。
5. 只有 `low` 在破碎語境顯著落後且 `medium` 可修復時，才對該類工作升至 `medium`。

本次沒有執行上述付費 A/B，因此「`low` 是合理預設」有官方指引與現有成本數據支持；「`low` 的品質等同 `max`」仍未驗證。
