# HDD 會議完整 ASR 與通用修正流程驗證

> **後續狀態：** 下方的 staging 判定是當時僅依 accuracy evidence 得出的保守
> 結論。使用者之後明確決定把 Qwen 切為 production 主轉錄；正式部署與 9 組
> 歷史 Azure 盲比對見
> [Qwen 主轉錄與既有 Azure 歷史資料盲比對](2026-07-29-qwen-vs-stored-azure.md)。
> 這個 rollout 決策不會把缺少人工 reference 的證據改寫成 accuracy 證明。
>
> 驗證日期：2026-07-29
> 結論：內容品質閘門與縮短切片重試確實有用；更換單一 ASR、把影片
> OCR 詞彙直接塞進 ASR prompt，或讓 diarization 改寫文字，均未證明能可靠
> 修復專業術語。

## 結論先行

| 方法 | 完整音訊結果 | 判定 |
|---|---|---|
| 不含領域詞的 repetition／sparse gate | 攔下 Qwen 一個 HTTP 200 但內容失敗的 60 秒 chunk；兩個 30 秒重試都恢復正常 | **GO** |
| Qwen3-ASR 1.7B、60 秒切片 | 93.5 分鐘音訊約 201.1 秒完成，經 gate 後無可疑長重複；但沒有輸出畫面中的 `Tray盤`，精確術語仍錯 | **只適合 staging／shadow，不可直接取代主 ASR** |
| production 設定的 faster-whisper large-v3 | 完整音訊約 307.8 秒完成，沒有觸發 gate；精確術語同樣不穩定 | **不可只因無 loop 就取代主 ASR** |
| 現有 Azure 主轉錄成品 | 約 723.5 秒完成；同一 gzip gate 會攔下開頭 5 分鐘及結尾 3 分鐘的重複內容 | **本地 source 已補 gate；尚未部署** |
| 影片 OCR 詞彙直接餵給 ASR | Qwen 沒有恢復 `Tray盤`；Azure 有一段由 172 字降到 54 字 | **NO-GO** |
| 影片／文件證據限制式 display correction | 可修正 `入站操作`、`MoveIn`、`MES3`、`GroupID` 等畫面確實出現的拼法；保守模型沒有硬猜爭議同音詞 | **只接受 high-confidence、保留 rawText 的候選** |
| `gpt-4o-transcribe-diarize` | 能提供匿名 speaker span；沒有證明能改善主文字，且較慢 | **只作 speaker evidence** |

最重要的更正是：先前把 `舌片`次數當成「正確術語」的判斷已撤回。原始會議
影片的流程圖及 GUI 明確出現 `Tray盤`、`Input Tray Setting`、`MVS`、
`MoveIn`、`MES3`、`GroupID`、`HDD`。這能證明會議的正式詞彙包含
`Tray盤`，但在沒有人工逐字聽打的情況下，仍不能斷言每一個爭議發音都必然是
`Tray盤`。因此 `舌片／蛇片`只能當模型輸出差異，不能當 accuracy 分數。

## 驗證邊界

- 正確來源是 5,609.520 秒、16 kHz mono PCM WAV。
- WAV SHA-256：
  `33609d7341182581ecbe393313a9263b74f17e8755351d343b1115b4d242848c`。
- 同場原始 MP4 用來取得會議當時實際顯示的流程圖、GUI 與 API 文件；沒有把
  PLAUD 逐字稿、目標答案、人工逐字稿或固定 phrase list 餵給主 ASR。
- OCR context A/B 是在無提示 baseline 鎖定後才做，詞彙只來自原始影片畫面。
- 分享目錄沒有人工逐字稿或人工會議記錄，因此本輪不能誠實計算 CER、WER、
  數字正確率或完整漏字率。字數、模型相似度及術語次數都不是 ground truth。
- provider 原始輸出與 display candidate 分開；任何後處理結果都不得覆蓋
  provider raw text。

## 完整 93.5 分鐘實跑

本機模型時間包含完整音訊推論；「總時間」另加冷載入。GPU 記憶體是在模型載入
並完成一次推論後由同一 process 實測，不代表目前共享 GPU 一定能同時容納兩個
模型。

| 項目 | Qwen3-ASR 1.7B | faster-whisper large-v3 | 既有 Azure 成品 |
|---|---:|---:|---:|
| 實際切片 | 94 × 約 60 秒 | 47 × 約 120 秒 | 22 次 provider request |
| 設定 | 無前段 transcript context | `beam_size=5`、無 VAD，與 production 相同 | `gpt-4o-transcribe` |
| 接受文字字元 | 26,573 | 23,692 | raw 25,612／display 25,381 |
| 正規化字元 | 23,293 | 23,293 | 22,898 |
| 原始切片 gate 通過 | 93 / 94 | 47 / 47 | 成品事後檢查有 8 個可疑分鐘 |
| 內容失敗重試 | 1 個 60 秒 chunk 拆成 2 × 30 秒 | 0 | 現有成品未攔截長重複 |
| 模型載入 | 4.685 秒 | 37.011 秒 | 不適用 |
| 完整推論／pipeline | 196.393 秒 | 270.781 秒 | 723.5 秒 |
| 載入加推論 | 201.078 秒 | 307.792 秒 | 723.5 秒 |
| 約為音訊實時速度 | 27.9× | 18.2× | 7.8× |
| chunk latency p50／p95／max | 1.694／2.214／20.700 秒 | 4.480／12.307／13.545 秒 | artifact 未保存同口徑分位數 |
| GPU process memory | 5,036 MiB | 4,050 MiB | 雲端 |

### Qwen shadow API 部署驗證

同日另以 Qwen 官方映像
`qwenllm/qwen3-asr@sha256:fb75b775f089e06e5a1aaebffd421e37505cc630d50c86d889d95ffa45a7e16a`
啟動獨立 `ai-notetacker-qwen3-asr-shadow` 容器。服務只綁定
`127.0.0.1:8011`，使用 `Qwen/Qwen3-ASR-1.7B`、40% GPU memory、
8,192-token context、單一並行 request 及 `unless-stopped` restart policy。
它沒有接入 job queue，也沒有取代 Azure 正式輸出。

vLLM 預設 65,536-token context 需要 7.0 GiB KV cache，在 40% GPU 上限下
第一次啟動明確失敗；縮到本次 60 秒 ASR 足夠的 8,192 tokens 後服務健康。
第一個 cold transcription request 花 84.300 秒，後續用正確 WAV 的 94 個
一分鐘 chunk 全部經 OpenAI-compatible transcription API 成功：

| 項目 | 部署後 vLLM shadow |
|---|---:|
| 成功 request | 94 / 94 |
| 接受文字字元 | 27,361 |
| provider request 合計 | 110.482 秒 |
| chunk latency p50／p95／max | 1.168／1.487／1.654 秒 |
| gzip ratio 大於 4.0 | 0 |
| chunk 73 | 294 字、gzip ratio 1.646，沒有原本的 2,504 字 loop |
| `Tray`／`Tray盤` | 0／0 |
| `舌片`／`蛇片`／`條碼` | 34／9／28 |
| `MoveIn` 類／`MES3`／`MVS`／`GroupID`／`HDD` | 8／0／13／3／0 |
| Qwen engine GPU memory | 6,052 MiB |

API 的 `text` 仍夾帶 `language Chinese<asr_text>`控制標記；上表只在評測時計數
前移除標記，沒有改寫辨識內容。若日後接入 worker，必須先有最小 parser、
正體中文 display normalization、immutable raw evidence、usage 及 failure
contract，不能把目前服務直接宣稱為 drop-in provider。

同一個 5,460–5,520 秒片段，Qwen display-normalized 候選為 296 字，
PLAUD 重疊 segments 為 252 字，正規化 sequence similarity 為 `0.8703`；
舊 Azure artifact 因尾段 loop 為 323 字，對 PLAUD similarity 只有 `0.2016`。
Qwen／PLAUD／舊 Azure 的 `舌片`為 4／1／0，`蛇片`為 0／0／22，
`條碼`為 4／2／22。這只能證明 Qwen 在這個片段明顯比壞掉的 Azure artifact
接近 PLAUD；PLAUD 不是 ground truth，而且 Qwen 仍完全沒有恢復 `Tray盤`。

另一次 faster-whisper 開啟 VAD 的完整跑測只得到 21,693 字，明顯低於與
production 相同的無 VAD 設定，故不拿來作 provider 排名；它只證明這支會議
不能假設 VAD 一定不漏內容。

## HTTP 200 內容失敗的完整證據

品質閘門完全不需要知道 `Tray盤`或任何領域答案：

- 正規化 UTF-8 文字 gzip ratio 大於 `4.0`；
- 單一重複句占比大於 `0.5`；
- 音訊平均音量高於 `-45 dBFS`、時長至少 20 秒，但每分鐘少於 15 個正規化
  字元。

Qwen 的 chunk index 73（4,380–4,439.968 秒）回傳 HTTP 200，但原始輸出有
2,504 字，gzip ratio `41.966`，主要重複句占 `0.943`。這不是可接受的逐字稿。
同一原始音訊拆成兩段約 30 秒重跑後：

| 重試 | 字元 | gzip ratio | 結果 |
|---|---:|---:|---|
| 4,380–約 4,410 秒 | 139 | 1.471 | 通過 |
| 約 4,410–4,439.968 秒 | 155 | 1.472 | 通過 |

因此「HTTP 成功不等於內容成功」已由完整音訊重現。縮短原音訊重試也不是猜字
或刪字：失敗輸出仍保留在診斷 artifact，正式 display 只接受重跑通過 gate 的
294 字。

把同一 gzip check 套到既有 Azure 完整成品，會攔下：

- 第 0–4 分鐘：大量重複「我先錄製」；
- 第 91–93 分鐘：大量重複「蛇片上面的條碼要怎麼弄」。

也就是共 8 個分鐘區段。這些 response 已經是 HTTP 200，所以目前只針對
HTTP 400 的 summary retry 完全抓不到。改動前的 sparse gate 也只抓「有聲音
但字太少」；本地 source 現已加入至少 20 秒、gzip ratio 大於 `4.0`的
repetition gate，尚未部署到執行中的 worker。

### 本地實作驗證

- Azure transcriber 的 28 個針對性測試全部通過；新增測試涵蓋 30 秒重切、
  兩次 bounded retry、移除前段生成 context、保留 glossary、usage 計數及
  暫存檔清理。
- 用新程式按 production 的五分鐘邊界重播既有 Azure artifact，只攔下
  0–300 秒及 5,400–5,609.52 秒兩個已知異常 provider chunk；中間 17 個 chunk
  沒有誤攔。兩段 gzip ratio 分別為 `33.683`及`4.562`。
- 同一 gate 判定 Qwen 原始 loop 為 `repetitive`，ratio `41.966`；30 秒恢復
  後的 294 字 ratio `1.701`並通過。
- 使用正確 WAV 的 5,460–5,520 秒做容器內真實 ffmpeg smoke，產生兩段
  30.096 秒 MP3，時間範圍為 5,460–5,490 秒及 5,490–5,520 秒。
- `openspec validate improve-uploaded-meeting-note-quality --strict
  --no-interactive`通過。執行中 worker 容器沒有重建或部署。

## 原始影片提供的獨立術語證據

以下文字來自會議當時共享的原始畫面，不是 PLAUD 答案：

| 影片時間 | 畫面 | 可直接確認的正式字串 |
|---:|---|---|
| 270 秒 | GUI – Assembly Config | `Input Tray Setting`、`Scanner Setting`、`LINE 1–6` |
| 330、900 秒 | HDD Insertion Flow Chart | `MVS`、`GroupID`、`HDD`、`Tray盤`、`NG盤`、`2D相機確認Tray盤是否為空` |
| 1,500 秒 | 流程圖後段 | `GroupID位置`、`讀取條碼`、`MVS確認條碼資訊`、`Tray盤` |
| 2,670 秒 | MES3 API 文件 | `MES3 API接口文档`、`入站操作（MoveIn）`、`GroupID`、`terminalid` |
| 3,090 秒 | GUI – Input Tray Setting | `Input Tray Setting`、`Single Model`、畫面原字 `Duel Model` |
| 3,810 秒 | Weekly Report | `Inventec`、`Inventec Confidential` |
| 4,530 秒 | Scanner Setting | `With Scanner`、`Without Scanner` |
| 5,490、5,550 秒 | GUI – 主畫面 | `MES STATUS`、`MES Message`、`Inserting HDD` |

可視證據推翻的是「模型多寫 `舌片`就比較準」這個評分方式，而不是直接替每一
個發音填答案。尾段談到「提供照片／規則」且說它和「放硬碟的那個」一樣，
`Tray盤`是有強證據的候選；要把每一處寫入正式逐字稿，仍需人工聽打確認。

## 精確術語輸出

下表只列模型實際輸出，不把任一列當 reference：

| exact output | Qwen | faster-whisper production | Azure 成品 |
|---|---:|---:|---:|
| `Tray`／`Tray盤` | 0／0 | 3／0 | 0／0 |
| `MoveIn`／`move in`／`moving` | 0／1／4 | 0／4／5 | 0／3／6 |
| `MES3`／`MES`／`MVS` | 0／10／7 | 3／15／11 | 1／13／9 |
| `GroupID`／`group ID` | 0／4 | 0／3 | 0／5 |
| `NG盤` | 0 | 2 | 6 |
| `HDD` | 0 | 0 | 0 |
| `舌片`／`蛇片` | 31／3 | 7／31 | 1／88 |

Azure 的 88 次 `蛇片`有 60 次來自同一尾段 loop，因此更不能拿 88:1 當 88
個獨立辨識錯誤。Qwen 的 31 次 `舌片`也不是 31 次正確；它同時完全沒有恢復
原始畫面明列的 `Tray盤`。

## 各種通用方法 A/B

### 1. 自動畫面詞彙直接進 ASR context

Qwen 使用從 14 張原始影片 frame 自動擷取的 99 個可見字串，在 240、300、
5,460、5,520 秒四段做 A/B：

- 四段的 `Tray`及`Tray盤`仍全為 0；
- 爭議同音詞沒有改正；
- 只有一段把分開的 `M E S`更常寫成 `MES`。

Azure 在 240、300、1,500、5,460、5,520 秒做同樣 A/B：

- 240 秒從 `蛇片`變成不合理的「十二片」，仍沒有 `Tray`；
- 300 秒在 `舌片`、`MES`、`MVS`之間改變，但沒有恢復 `Tray盤`；
- 1,500 秒由 172 字降到 54 字，發生嚴重 omission；
- 5,460 秒雖多出一次 `Tray`，同段其他爭議詞仍是 `蛇片`。

結論：自由文字 OCR context 對 decoder 的影響不可控，不應直接投入
production ASR prompt。

### 2. 證據限制式轉錄後校正

把 Qwen 的六個原始 chunk 與同一場會議畫面可見字串交給 Luna、Sol，並要求：

- 只能換成畫面上精確出現的字串；
- 必須輸出 evidence、reason、confidence；
- 不確定時列 unresolved，不得猜；
- raw text 不變。

兩個模型都能提出有可見證據的候選，例如：

- `路站操作` → `入站操作`
- `moving` → `MoveIn`
- `M E S 三點零` → `MES3`
- `group ID` → `GroupID`
- 部分 `UI` → `GUI`

兩個模型都沒有把所有 `舌片／蛇片`硬改成 `Tray盤`，而是保留 unresolved。
這是正確的保守行為。只有 `confidence=high`且 replacement 完整出現在可信畫面
或會前文件時，才適合成為 display review candidate；medium confidence 例如
`N S → MES`仍可能其實是 `MVS`，不得自動寫入。

### 3. 多 ASR 比較

Qwen 與 production faster-whisper 的每分鐘正規化文字相似度：

- p10：`0.7056`
- median：`0.8283`
- p90：`0.8991`
- min：`0.2373`

低相似區段逐段檢查沒有單一固定贏家：

- 開頭 Qwen 較合理，faster-whisper 與 Azure 都有重複；
- 63 分鐘 AI region／class 討論，faster-whisper 與 Azure 保留較多內容；
- 75 分鐘畫面明列 `With Scanner / Without Scanner`，三個 ASR 都有不同錯聽；
- 87–88 分鐘的 22、40、44、132 等數字，各模型互相衝突。

相似度只能用來找需要複核的片段，不能自動選正字，也不能代替 CER/WER。

## 最小可落地流程

```text
原始音訊
  → 主 ASR
  → content-agnostic repetition / sparse gate
      → 失敗：用同一原音訊縮短切片，有限重試
      → 通過：保存 immutable rawText
  → 從會前文件／同場影片畫面自動取得可追溯詞彙
  → 只產生 high-confidence、exact-evidence display candidate
  → 多 ASR disagreement 只標記 review span，不自動合併
  → diarization 只附加 speaker evidence
```

這個流程比「換一個更強模型」多一道重要保護：模型即使回 HTTP 200，也不能把
明顯失敗內容送進摘要。它仍不宣稱能自動解出所有首次出現、聲學上無法區分的
同音術語。

## 人工複核包與剩餘驗收

為了補上唯一缺少的 ground truth，已從同一 SHA-256 WAV 產生 12 段各約
60 秒、共 12 分鐘的 MP3，不含 PLAUD 文字：

`/tmp/ai-notetacker-hdd.M1Xz3T/full-validation-v1/review-clips/`

| 檔案 | 複核重點 |
|---|---|
| `0240-300.mp3` | 六個 tray／條碼／UI 流程 |
| `0300-360.mp3` | 入站、MoveIn、MES3、MVS |
| `0900-960.mp3` | Tray盤與條碼流程 |
| `1440-1500.mp3` | GroupID、掃碼與定位 |
| `1980-2040.mp3` | Tray／條碼上下文 |
| `2340-2400.mp3` | 爭議同音詞 |
| `3780-3840.mp3` | AI region／class，模型低一致 |
| `4380-4440.mp3` | Qwen 原始 loop 與 30 秒恢復 |
| `4500-4560.mp3` | With／Without Scanner |
| `5220-5280.mp3` | slot、22／44 等數字 |
| `5460-5520.mp3` | 尾段條碼與 tray |
| `5520-5580.mp3` | 照片、規則、放 HDD 的 tray |

每段實測 duration 為 60.084 秒，整包約 3.6 MiB。由不看任何 provider 輸出的
人工標註者逐字聽打，再由領域人員只裁決爭議術語，才能計算：

- 中文 CER 及 insertion／deletion／substitution；
- `Tray盤`、`MoveIn`、`MES3`、`MVS`、`GroupID`、數字與 action item
  exact accuracy；
- gate false positive／false negative；
- Qwen、faster-whisper、Azure 哪一個真的更準。

在這份 reference 完成前，已能確認「內容閘門有用」，但不能誠實宣稱任何主
ASR 已達到或超過 PLAUD 的逐字準確率。

## 實驗產物

- Qwen 完整跑：
  `/tmp/ai-notetacker-hdd.M1Xz3T/full-validation-v1/results/qwen3-asr-1.7b-full-60s-gated.json`
- production faster-whisper 完整跑：
  `/tmp/ai-notetacker-hdd.M1Xz3T/full-validation-v1/results/faster-whisper-large-v3-full-120s-production-gated.json`
- 完整比較：
  `/tmp/ai-notetacker-hdd.M1Xz3T/full-validation-v1/results/full-comparison-production-summary.json`
- 影片可見詞彙：
  `/tmp/ai-notetacker-hdd.M1Xz3T/full-validation-v1/results/video-frame-visible-vocabulary-gpt-5.6-sol.json`
- 低一致區段畫面詞彙：
  `/tmp/ai-notetacker-hdd.M1Xz3T/full-validation-v1/results/video-frame-visible-vocabulary-low-agreement.json`
- Qwen／Azure 視覺 context A/B：
  `/tmp/ai-notetacker-hdd.M1Xz3T/full-validation-v1/results/qwen3-asr-visual-context-target-ab.json`
  與
  `/tmp/ai-notetacker-hdd.M1Xz3T/full-validation-v1/results/azure-visual-context-ab.json`
- evidence-constrained correction：
  `/tmp/ai-notetacker-hdd.M1Xz3T/full-validation-v1/results/visual-evidence-correction-gpt-5.6-luna.json`
  與
  `/tmp/ai-notetacker-hdd.M1Xz3T/full-validation-v1/results/visual-evidence-correction-gpt-5.6-sol.json`
- 畫面 contact sheet：
  `/tmp/ai-notetacker-hdd.M1Xz3T/full-validation-v1/frames/term-contact-sheet.png`

`/tmp` artifacts 含內部會議內容，不加入 Git；本文件只保留聚合數值、證據界線
及可重現路徑。
