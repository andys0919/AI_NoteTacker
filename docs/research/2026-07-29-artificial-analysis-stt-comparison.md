# Artificial Analysis 非串流 STT 榜單與本專案選型

> 查核日期：2026-07-29
> 指定頁面：[Artificial Analysis Speech to Text Non-streaming Leaderboard](https://artificialanalysis.ai/speech-to-text/non-streaming)
> 結論：榜單不能證明目前自架的 `Qwen3-ASR-1.7B` 輸給其他模型。維持 Qwen
> 主轉錄，只盲測 `Scribe v2` 與 `Voxtral Mini Transcribe 2` 兩個 challenger。

## 結論

1. Artificial Analysis（AA）的 `AA-WER v2.0` 是有人工 reference 的第三方
   benchmark，適合比較榜上**同一個確切模型／API**的英語轉錄表現。
2. 它不是臺灣中文、台語、中文同音術語或本公司會議 benchmark。不能把榜上
   `2.2%`、`2.4%` 直接當成「舌片／蛇片」或 HDD 會議的錯誤率。
3. AA 頁面中的 `Qwen3.5 Omni Flash`、`Qwen3.5 Omni Plus`、`Qwen3 ASR
   Flash` 都不是本專案自架的 `Qwen3-ASR-1.7B`。
4. AA 的資料物件雖列出 `Qwen3 ASR 1.7B`，其 AA-WER、三個資料集分數、速度
   與價格目前都是空值；因此榜單沒有提供它與 `Scribe v2`、MAI 或 OpenAI 的
   直接比較。
5. `MAI-Transcribe-1.5` 的英語榜單結果很好，但仍是 public preview、沒有
   SLA、只明列簡體中文、不支援 diarization，而且現有 Azure Speech
   `eastus2` 不支援 MAI Transcribe。
6. 現在沒有理由撤回 Qwen primary。下一輪只需用同一批盲測音檔挑戰兩個最有
   產品價值的候選：
   - `Scribe v2`：AA-WER 最低的可直接使用 meeting API 候選，官方同時支援
     Mandarin、Cantonese、speaker diarization。
   - `Voxtral Mini Transcribe 2`：中文、diarization、word timestamps、
     3 小時長音訊在同一 API，價格較低。

## AA 到底量什麼

AA 的方法頁把非串流模型量成三個維度：

- `AA-WER`：`(替換 + 插入 + 刪除) / reference 字數`，越低越好。
- `Speed Factor`：`音訊秒數 / API response 秒數`，越高越快；包含網路時間。
- `Price`：統一換算為每 1,000 分鐘音訊的美元估算成本。

來源：[AA Speech to Text Benchmarking Methodology](https://artificialanalysis.ai/speech-to-text/methodology)。

### AA-WER v2.0 資料組成

| 資料集 | 範圍 | 音訊量 | 權重 |
|---|---|---:|---:|
| AA-AgentTalk | 私有 held-out；voice agent、產業術語、會議等 | 約 250 分鐘、469 檔 | 50% |
| VoxPopuli-Cleaned-AA | 英語子集，歐洲議會發言 | 約 119 分鐘、628 檔 | 25% |
| Earnings22-Cleaned-AA | 英語企業財報電話，含技術詞及重疊說話 | 約 115 分鐘、6 檔 | 25% |

合計約 484 分鐘，也就是約 8 小時。每個資料集先依音訊長度加權，再以
`50/25/25` 合成 AA-WER。來源同上及
[AA-WER v2 說明](https://artificialanalysis.ai/articles/aa-wer-v2)。

### 英語與正規化限制

這個 benchmark 是英語導向，不是中文 benchmark：

- VoxPopuli 明確使用 English subset。
- Earnings22 是英語企業財報電話。
- AA-AgentTalk 的公開樣例、ID、數字、英美拼字及 17 種 accent group 都按
  英語場景設計。
- 比較前使用 OpenAI Whisper 的 English normalizer，再加上 AA 自訂英語規則。
- 會移除大小寫、標點、`uh/um` 等 filler，統一縮寫、數字、英美拼字、電話及
  ID 格式，也接受部分專有名詞等價拼法。

因此 AA-WER 不會懲罰部分格式與 filler 差異，但本專案的 verbatim、正體中文、
中文同音字、台語、逐字證據需求可能正好在這些處不同。AA 沒有公布
`zh-TW`、Minnan、臺灣會議或 HDD 領域分數。

### 長音訊與速度限制

- Earnings22 原則上送完整 14–22 分鐘音訊。
- API 若有時限，AA 先切約 9 分鐘；限制更短的模型再切約 30 秒。
- `GPT-4o Transcribe` 使用約 9 分鐘切片。
- `Qwen3 ASR Flash` 使用約 30 秒切片。
- Speed Factor 是最近 7 日 trial 的中位數，以 10 分鐘音訊測量；短於 1 分鐘
  的表現可能不同。

所以 Speed Factor 不是首 token latency，也不能直接套到本專案 60 秒切片、
本機 GPU 或 98 分鐘會議。

## 2026-07-29 榜單重點

下表的 AA-WER 與價格由 AA 擁有；速度是會變動的最近 7 日中位數，取本次查核
頁面的約值。`10 分鐘估時 = 600 / Speed Factor`，只用來建立量級。

| 模型／AA API | AA-WER | Speed Factor | 10 分鐘約需 | USD/1,000 分鐘 |
|---|---:|---:|---:|---:|
| Fun-Realtime-ASR-preview | 1.73% | 未列完整 API 值 | — | — |
| Scribe v2, ElevenLabs | 2.18% | 32.8× | 18.3 秒 | 3.67 |
| MAI-Transcribe-1.5 | 2.38% | 約 266–276×¹ | 約 2.2 秒 | 6.00 |
| Smallest AI Pulse Pro | 2.43% | 250.6× | 2.4 秒 | 4.00 |
| Voxtral Small, Mistral | 2.77% | 64.6× | 9.3 秒 | 4.00 |
| GPT Transcribe, OpenAI | 3.31% | 33.2× | 18.1 秒 | 4.50 |
| Qwen3.5 Omni Plus | 3.55% | 97.9× | 6.1 秒 | 0.00² |
| Voxtral Mini Transcribe 2 | 3.59% | 77.9× | 7.7 秒 | 3.00 |
| GPT-4o Transcribe | 3.96% | 35.2× | 17.0 秒 | 6.00 |
| Qwen3 ASR Flash, Alibaba | 5.80% | 未列 | — | — |
| Qwen3-ASR 1.7B | 無資料 | 未列 | — | — |
| GPT-4o Transcribe Diarize | 未列榜 | 未列 | — | — |

¹ AA 發布 MAI-Transcribe-1.5 時報告約 `276×`；榜頁速度為最近 7 日中位數，
不同查核快照約在 `266–276×`，不應視為固定 SLA。來源：
[AA MAI-Transcribe-1.5 分析](https://artificialanalysis.ai/articles/mai-transcribe-1-5-new-speech-to-text-model-leading-the-accuracy-speed-pareto-frontier/)。

² `0.00` 是 AA 當下的正規化價格欄位，不能據此推論 Alibaba API 永久免費。

## 使用者關心的模型逐一核對

### 自架 Qwen3-ASR-1.7B

Qwen 官方資料說明：

- 權重與程式公開，Apache 2.0。
- 30 種語言與 22 種中文方言。
- 明列 Chinese、Cantonese、Minnan，另支援英文、日文、韓文等。
- 同一模型支援 offline、streaming、長音訊與語言識別。
- 可用 `qwen-asr`、Transformers 或 vLLM 自架；vLLM 提供
  OpenAI-compatible transcription API。
- timestamp 要另外搭配 `Qwen3-ForcedAligner-0.6B`。
- 官方文件沒有宣稱 `Qwen3-ASR-1.7B` 內建 speaker diarization。

來源：[QwenLM/Qwen3-ASR 官方 repository](https://github.com/QwenLM/Qwen3-ASR)。

這是本專案模型；不能拿 AA 的 `Qwen3.5 Omni` 或 Alibaba
`Qwen3 ASR Flash` 分數代替。

### MAI-Transcribe-1.5

Microsoft 官方限制：

- Public preview，沒有 SLA，官方不建議 production workload。
- 支援 43 種語言，但中文只明列 `zh: Chinese (simplified)`。
- 不支援 diarization。
- 不支援 prompt-tuning；可用 phrase list/entity biasing 及 verbatim style。
- WAV、MP3、FLAC，單檔小於 300 MB。

來源：[MAI-Transcribe in Azure Speech](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-transcribe)。

更關鍵的是區域：

| Azure Speech region | MAI Transcribe |
|---|---|
| `eastus` | 支援 |
| `northeurope` | 支援 |
| `southeastasia` | 支援 |
| `westus` | 支援 |
| `eastus2` | **不支援** |

來源：[Azure Speech supported regions](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/regions?tabs=llmspeech)。

這直接解釋先前即使 key 與 Speech endpoint 正確，`eastus2` resource 仍不能用
MAI。若要重試，必須新建支援區域的 Speech resource；不能只改 URL 或 model
字串。

### GPT Transcribe、GPT-4o Transcribe 與 Diarize

AA 有測：

- `GPT Transcribe`：3.31%。
- `GPT-4o Transcribe`：3.96%。

AA 沒有測 `gpt-4o-transcribe-diarize`，不能把 `GPT-4o Transcribe` 的 3.96%
當成 diarize 模型分數。

OpenAI 官方現在建議新的錄音檔轉錄從 `gpt-transcribe` 開始；它支援自由文字
context、keyword hints、多語言 hints及 code-switching。需要 speaker label
時才改用 `gpt-4o-transcribe-diarize`。後者只在 Transcription API 提供；
超過 30 秒要使用 chunking strategy，且不接受 transcription prompt。

來源：

- [OpenAI Transcription guide](https://developers.openai.com/api/docs/guides/transcription)
- [GPT Transcribe model](https://developers.openai.com/api/docs/models/gpt-transcribe)
- [GPT-4o Transcribe Diarize model](https://developers.openai.com/api/docs/models/gpt-4o-transcribe-diarize)

因此本專案讓 diarize 只產生「誰在什麼時間說話」的 speaker evidence，而不能
改寫 Qwen 主文字，是正確的責任分離；diarization 不會自動修復「舌片／蛇片」
這類同音 ASR 錯字。

### Scribe v2

ElevenLabs 官方能力：

- 90+ 語言，明列 Mandarin Chinese 與 Cantonese。
- word-level timestamps。
- speaker diarization 最多 32 位 speaker。
- keyterm prompting 最多 1,000 個詞。
- 單檔最高 3 GB、標準模式最長 10 小時。

來源：[ElevenLabs Scribe v2 transcription documentation](https://elevenlabs.io/docs/overview/capabilities/speech-to-text/)。

它沒有明列 Minnan；是否適合臺灣中文與台語混說，仍必須用本專案盲測回答。

### Voxtral Mini Transcribe 2

Mistral 官方能力：

- 13 種語言，含 Chinese。
- 同一 transcription API 支援 speaker diarization、word timestamps。
- 單次最長 3 小時。
- 可給最多 100 個 context-bias 詞，但官方說非英語仍屬 experimental。
- API 價格為 `$0.003/min`，即 `$3/1,000 min`。
- Batch Mini Transcribe 2 是 Premier API；官方公開權重的是 Voxtral Realtime，
  不應混稱成同一個可自由自架的 batch 模型。

來源：

- [Mistral Speech Transcription docs](https://docs.mistral.ai/studio-api/audio/speech_to_text)
- [Mistral Voxtral Transcribe 2 announcement](https://mistral.ai/news/voxtral-transcribe-2/)

## 與本專案既有實測怎麼一起看

本專案已用 9 組歷史錄音盲比 Qwen 與既有 Azure artifact：

- 共 171.52 分鐘。
- Qwen 主轉錄共 201.74 秒，約 `51×` realtime。
- 9/9 成功。
- 175/175 request 沒有 prompt、phrase list、glossary 或 Azure/PLAUD 答案。
- 三組長錄音的 Qwen/Azure 文字量為 `1.84–2.89×`。
- 英文錄音中，Azure artifact 變成中文翻譯；Qwen 保存原英文。

完整證據：
[Qwen 主轉錄與既有 Azure 歷史資料盲比對](2026-07-29-qwen-vs-stored-azure.md)。

這些數字**不是 WER**，因為沒有事先建立的人工 reference。它們只證明：

- Qwen 流程可跑完整錄音且速度足夠。
- Qwen 與既有 Azure 成品差異很大。
- 長錄音內容覆蓋及原語言保留對目前產品更有利。

它們不能證明 Qwen 的中文錯誤率是 44.15%，也不能與 AA 的英語 AA-WER 直接
相減。

## 建議

### 現在

保持：

```text
Qwen3-ASR-1.7B 主轉錄
  + Azure gpt-4o-transcribe-diarize speaker evidence
  + content-agnostic quality gate / 有界重試
```

不要因 AA 英語榜單直接改 production provider。

### 只測兩個 challenger

1. `Scribe v2`
   - 理由：AA-WER 2.18%，官方支援 Mandarin/Cantonese 及 diarization。
2. `Voxtral Mini Transcribe 2`
   - 理由：中文、diarization、timestamps、3 小時長檔及較低 API 成本。

`MAI-Transcribe-1.5` 暫不列入這輪：現有 `eastus2` 無法呼叫，且 preview、
簡體中文、沒有 diarization。只有在新建支援區域資源後，才把它當第三個條件式
候選，不要先為榜單分數改 production。

### 勝負標準

同一批未洩漏答案的臺灣錄音，先由人工建立 reference，再比較：

- 中文 CER。
- 台語／中英 code-switch CER。
- 已知及未知專有名詞正確率。
- false insertion、漏句、repetition loop。
- speaker DER／speaker-attributed CER。
- 端到端時間與每 1,000 分鐘成本。

在這份中文 benchmark 完成前，AA 最合理的用途是挑 challenger，不是替本專案
宣布冠軍。
