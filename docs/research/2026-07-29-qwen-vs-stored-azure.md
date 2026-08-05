# Qwen 主轉錄與既有 Azure 歷史資料盲比對

> 實測日期：2026-07-29
> 範圍：9 組已由 `azure-openai-gpt-4o-transcribe` 完成的歷史錄音，共
> 171.52 分鐘。
> 結論：Qwen 已適合依 operator 決策成為新工作的主轉錄；它在長音檔與
> 原語言保留上明顯改變既有 Azure 行為，但沒有人工 reference，不能把兩模型
> 相似度誤稱為準確率。

## 比對方法

- Qwen 只收到原始錄音與 `qwen3-asr-1.7b` model identity；request 不含
  `prompt`、phrase list、job glossary 或前一段模型文字。
- Azure 歷史逐字稿、PLAUD 文字、檔名推測詞、phrase list、hotword 及下表的
  術語計數都沒有送入 Qwen。
- 每組都是 Qwen 完成後，才把 Qwen display text 與資料庫既有 Azure segments
  做比較。
- 為隔離主 ASR，這次 benchmark 不呼叫 diarization 或 summary。
- 相似度先做 Unicode NFKC、大小寫統一，並移除空白與標點，再用 character
  sequence similarity 計算。它只表示兩份輸出的文字一致程度。
- 字數比為 `Qwen 正規化字數 / Azure 正規化字數`；大於 1 代表 Qwen 保存較多
  文字，不直接等於較準。
- gzip ratio 只作內容重複異常檢查；Qwen 的每個 60 秒 chunk 仍先通過正式
  repetition／sparse quality gate。

## 結果

| 歷史資料 | 音訊分鐘 | Azure 字元 | Qwen 字元 | Qwen/Azure 字數 | 一致度 | 實跑秒 |
|---|---:|---:|---:|---:|---:|---:|
| 台語實錄 WAV | 0.45 | 126 | 126 | 1.000× | 0.6984 | 0.71 |
| 台語短檔 MP3 | 0.56 | 131 | 131 | 1.000× | 0.8931 | 0.82 |
| 模糊／口頭更正 MP3 | 0.60 | 138 | 137 | 0.993× | 0.9382 | 0.81 |
| 中文業務短檔 MP3 | 0.64 | 146 | 146 | 1.000× | 0.9315 | 0.80 |
| 英文業務短檔 MP3 | 0.67 | 148 | 439 | 2.966× | 0.0170† | 0.94 |
| 業務活動日報 M4A | 1.83 | 294 | 302 | 1.027× | 0.8725 | 1.91 |
| AI 整理 Podcast M4A | 22.65 | 2,142 | 6,180 | 2.885× | 0.4965 | 31.55 |
| PC1／PC2 盤點會議 M4A | 45.28 | 5,263 | 9,685 | 1.840× | 0.6131 | 56.69 |
| 英業達／所羅門進度會議 M4A | 98.84 | 10,793 | 19,898 | 1.844× | 0.5275 | 107.51 |

正式 Qwen service 第一次啟動後另觀察到一個 82.42 秒 cold warm-up request；
上表是完成 warm-up 後、移除所有 prompt 的最終重跑。

† 英文錄音的 Azure artifact 是中文翻譯，Qwen 則保留原始英文。兩者語言不同，
所以 `0.0170` 不能解讀為 Qwen 準確率低；依本專案「保留原語言」契約，Qwen
行為才符合要求。

聚合結果：

- 9/9 成功，0 組失敗。
- 全部 171.52 分鐘共花 201.74 秒；另有一次服務初啟後 82.42 秒 cold
  warm-up，不列入最終重跑。
- 175/175 個 Qwen HTTP request 都沒有 `prompt` multipart field，且沒有
  quality retry 額外 request。
- 相似度中位數 `0.6984`；依 Azure 字數加權為 `0.5585`。
- Qwen/Azure 字數比中位數 `1.027×`。
- 3 組長音檔的 Qwen/Azure 字數比為 `1.840×`、`1.844×`、`2.885×`。
- 0 組 Qwen 輸出殘留 `language ...<asr_text>` protocol marker。
- 0 組 Qwen 或 Azure 整稿 gzip ratio 超過 `4.0`；本次沒有整稿重複 loop。

## 看得見的差異

### 原語言保留

英文檔既有 Azure 成品開頭是：

> 今天我拜訪了台北醫學大學附設醫院……

同一音訊 Qwen 開頭是：

> This is Michael Chen. Today, I visited Taipei Medical University Hospital…

這不是一般同音字差異，而是 Azure 歷史 artifact 把英文轉成中文且縮短；Qwen
保留了原始英文及較完整內容。

### 短音檔

4 組中文／台語短檔與 1 組業務日報的字數比都在 `0.993×–1.027×`，一致度在
`0.6984–0.9382`。差異集中在：

- 台語詞形：Azure 的「我今早日」對 Qwen 的「我今仔日」；
- 實體同音字：例如「紅展／宏展」、「余振南／餘正南」；
- 口語保留與標準化：Qwen 較常保存「呃」、台語語尾及原始英文；
- 數字顯示：例如 `15` 與「十五」，不能只靠字面一致度判斷對錯。

沒有人工逐字聽打時，以上例子只能證明輸出不同，不能把任一模型當答案。

### 長音檔內容覆蓋

3 組長音檔中，Qwen 保存的正規化文字量是 Azure 的 `1.84×–2.89×`。差異不是
只有標點或繁簡體；Qwen 有多段連續、語意完整的談話，在 Azure artifact 中
找不到對應內容。例如 Podcast 在「更隱形的威脅」之後，Qwen 繼續轉出微粒
污染、皮屑纖維與晶片接腳的完整說明，而 Azure 直接跳到後段。

這是 Azure 歷史稿有 omission／壓縮風險的強證據，但仍不是 Qwen 每個字都正確
的證明。要得到真正的高低差百分比，必須由不看兩模型答案的人先做人工
reference，再計算 CER 與專有名詞正確率。

## 正式流程與時間邊界

新工作現在走：

```text
錄音／上傳
  → FFmpeg 產生 16 kHz mono WAV
  → Qwen3-ASR 1.7B 每 60 秒主轉錄
  → 移除 Qwen protocol marker
  → repetition／sparse quality gate
      → 失敗時只用同一原音訊縮短切片、有限重試
  → 保存 immutable rawText
  → OpenCC 正體中文 displayText
  → Azure gpt-4o-transcribe-diarize 並行提供 speaker evidence
      → 只在高信心對齊時附上匿名 speaker，不改 Qwen 文字
  → 儲存逐字稿
  → 摘要
```

本表時間只量 Qwen 主轉錄 benchmark，不含 Azure diarization 與 summary。
正式流程中 diarization 與 Qwen 並行；若 diarization 較慢，完整工作仍會等
speaker evidence 完成或明確失敗後再交付。Qwen 後續 3 組長音檔的實測約為
音訊實時速度 `43.1×–55.2×`。

## 部署讀回

- Compose service：`ai_notetacker-qwen3-asr-1`
- image：
  `qwenllm/qwen3-asr@sha256:fb75b775f089e06e5a1aaebffd421e37505cc630d50c86d889d95ffa45a7e16a`
- health：`healthy`
- restart count：`0`
- control plane health：`{"status":"ok"}`
- PostgreSQL global policy：
  `transcription_provider=qwen3-asr-1.7b`、
  `transcription_model=qwen3-asr-1.7b`
- 原本的 shadow 容器已停止並移除；正式環境只保留 Compose 管理的 Qwen
  service。

完整 HDD 正確 WAV、HTTP 200 內容失敗與通用 quality retry 證據見
[HDD 會議完整 ASR 與通用修正流程驗證](2026-07-29-full-asr-validation.md)。
