# HDD 會議音訊無答案提示 ASR 實測

> **狀態：部分結論已由完整音檔與原始影片驗證取代。** 本文件早期把
> `舌片`次數當成正確術語，這個判斷已撤回。原始畫面明列 `Tray盤`、
> `Input Tray Setting`、`MVS`、`MoveIn`、`MES3`及`GroupID`；在沒有人工
> reference 前，`舌片／蛇片`都只能算模型假設，不能當 accuracy。完整結果見
> [HDD 會議完整 ASR 與通用修正流程驗證](2026-07-29-full-asr-validation.md)。
> 使用者後續已明確核准 Qwen production rollout；正式部署與多組歷史 Azure
> 盲比對見
> [Qwen 主轉錄與既有 Azure 歷史資料盲比對](2026-07-29-qwen-vs-stored-azure.md)。
> 下列表格只保留為切片、延遲與 failure-mode 的歷史診斷。
>
> 實測日期：2026-07-29
> 目的：比較可落地的轉錄、切片、音訊前處理與文字校正方法，不研究或模仿
> PLAUD。
> 限制：這支 HDD 音訊已知曾發生術語錯誤，因此只能作 regression case，
> 不是用來估計一般化準確率的 blind holdout。

## 測試邊界

- 所有 ASR prompt 都是同一份通用指令：忠實轉錄、保留原語言、中文顯示為
  正體中文，不得依提示補詞。
- 沒有把 `舌片`、PLAUD 逐字稿、人工逐字稿、phrase list、hotword 或錯字
  replacement map 餵給任何 ASR。
- `舌片／蛇片`只在模型輸出完成後計數，沒有參與解碼或重試選擇。
- 多 ASR 共識的輸入只包含三個獨立 ASR 自己產生的候選，沒有人工正字。
- 原始 WAV 一律保留；文字正體化與英文字母空白正規化只用於顯示及計數，
  不回寫 provider raw transcript。

## 固定音訊

| 項目 | 值 |
|---|---|
| 原始 WAV SHA-256 | `33609d7341182581ecbe393313a9263b74f17e8755351d343b1115b4d242848c` |
| 格式 | PCM signed 16-bit little-endian、16 kHz、mono |
| 總長 | 5609.520 秒 |
| 主測試窗 | 0–600 秒 |
| 術語診斷窗 | 240–360 秒 |
| 尾段測試窗 | 5400–5609.520 秒 |

品質閘門使用不含術語的訊號：

- 120 秒輸出的 UTF-8 gzip ratio 大於 `4`，視為高重複可疑輸出，不能直接採用；
- 同一音訊經前處理後若文字量相對原始音訊與其他模型集體大幅下降，只能判為
  omission regression，不能把「沒有錯字」誤算成改善；
- 閘門只授權從原音訊縮短切片重跑，不直接刪除或替換文字。

## 關鍵 240–360 秒結果

`條碼*`、`MES*`、`MVS*`包含正體化及英文字母間空白正規化後的計數。
時間不含雲端以外的網路排程；本機模型欄位已另外註明是否排除模型載入。

| 方法 | 字數 | 舌片 | 蛇片 | 條碼* | MES* | MVS* | 秒 | max gzip | 判定 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Azure 120 秒 | 401 | 0 | 6 | 2 | 9 | 0 | 6.172 | 1.678 | 可用，但術語錯 |
| Azure 120 秒、`language=zh` | 423 | 0 | 6 | 2 | 9 | 0 | 5.720 | 無改善 |
| Azure 4×30 秒 | 415 | 0 | 6 | 2 | 9 | 0 | 12.634 | 無改善且較慢 |
| Azure loudness normalization | 443 | 0 | 6 | 2 | 9 | 0 | 6.190 | 無改善 |
| Azure denoise + normalization | 403 | 0 | 6 | 2 | 9 | 0 | 5.784 | 無改善 |
| faster-whisper large-v3、120 秒 | 447 | 7 | 0 | 2 | 12 | 0 | 4.020 | 輸出候選之一；正字未證實 |
| faster-whisper large-v3、4×30 秒 | 324 | 0 | 6 | 2 | 7 | 2 | 8.166 | 退步；載入另計 |
| faster-whisper loudness normalization | 237 | 0 | 4 | 2 | 6 | 0 | 8.163 | 拒收：漏稿 |
| faster-whisper denoise + normalization | 49 | 0 | 0 | 0 | 4 | 0 | 0.620 | 拒收：嚴重漏稿 |
| Qwen3-ASR 1.7B、120 秒原始結果 | 1562 | 19 | 0 | 2 | 0 | 0 | 9.575 | 拒收：repetition loop |
| Qwen3-ASR 1.7B、可疑段重切 4×30 秒 | 499 | 6 | 0 | 2 | 6 | 4 | 3.793 | 通過；載入另計 |
| Qwen3-ASR 1.7B、2×60 秒 | 493 | 6 | 0 | 2 | 9 | 0 | 3.963 | 速度／覆蓋候選；正字未證實 |
| `gpt-4o-transcribe-diarize`、120 秒 | 425 | 4 | 2 | 1 | 6 | 1 | 30.395 | 有 speaker，文字仍混錯 |
| 三 ASR 共識 + `gpt-5.6-luna` | 446 | 6 | 0 | 2 | 9 | 0 | 11.138 | 多數候選統一；正字未證實 |
| 三 ASR 共識 + `gpt-5.6-sol` | 464 | 6 | 0 | 2 | 9 | 0 | 12.524 | 多數候選統一；正字未證實 |

## 較長固定窗

| 方法 | 音訊 | 字數 | 舌片 | 蛇片 | ASR 推論秒 | max gzip |
|---|---|---:|---:|---:|---:|---:|
| Azure 120 秒切片 | 0–600 秒 | 1593 | 0 | 6 | 27.446 | 未觸發 |
| faster-whisper 120 秒切片 | 0–600 秒 | 1890 | 7 | 3 | 29.957 | 未觸發 |
| Qwen3-ASR 60 秒切片 | 0–600 秒 | 2238 | 7 | 0 | 14.493 | 1.608 |
| Azure 120 秒切片 | 5400–5609.520 秒 | 791 | 0 | 3 | 12.126 | 未觸發 |
| faster-whisper 120 秒切片 | 5400–5609.520 秒 | 835 | 0 | 6 | 7.220 | 未觸發 |
| Qwen3-ASR 60 秒切片 | 5400–5609.520 秒 | 1003 | 3 | 2 | 6.303 | 1.798 |

Qwen 60 秒全矩陣共處理 809.52 秒音訊，模型載入 4.547 秒、總程序
25.344 秒；14 個切片沒有觸發 repetition gate。這是單機 RTX 5080 的單次
測量，不是併發容量保證。

## 純文字校正與多 ASR 共識

將 Azure 的 0–600 秒輸出交給文字模型，只要求依逐字稿內部上下文校正，
沒有提供正字：

| 模型 | 舌片 | 蛇片 | 其他行為 |
|---|---:|---:|---|
| `gpt-5.6-luna` | 0 | 6 | 保留原錯字 |
| `gpt-5.6-terra` | 0 | 6 | 保留原錯字，另有 `Tray` 改寫 |
| `gpt-5.6-sol` | 0 | 0 | 將該概念猜成 `Tray`，並改寫 MES 解釋 |

所以單一錯誤逐字稿再交給較大文字模型，不足以恢復聲學上完全同音的正字；
模型可能只是把可見錯字換成另一個看似合理但仍未受聲音支持的詞。

同一 120 秒改用 Azure、faster-whisper、Qwen 三份獨立候選做共識裁決時，
Luna 與 Sol 都得到 `舌片 6／蛇片 0`。這是因為兩份獨立 ASR 都提出相同候選，
比單一錯誤逐字稿多了一項證據；但輸出仍出現 `勾選風扇機`、`音樂達`等其他
錯誤，不能直接覆蓋 raw transcript。

## 已排除的方法

1. **強制中文語言**：沒有改變 Azure 的同音字選擇。
2. **固定縮成 30 秒**：Qwen 受益，但 Azure 不變、faster-whisper 反而由
   `舌片 7／蛇片 0`變成`0／6`；切片長度必須按模型驗證，不能全域硬套。
3. **loudness normalization／一般降噪**：沒有改善 Azure，且使
   faster-whisper 大量漏稿。
4. **沿用前一段逐字稿 context**：曾讓部分字翻轉，但也把另一個 120 秒輸出
   從 464 字壓到 46 字，不能採用。
5. **只用文字模型事後猜字**：Luna、Terra 無法修復；Sol 改猜 `Tray`並動到
   其他實體。
6. **把 diarize 當主轉錄修正器**：有 speaker segment，但關鍵窗仍是
   `舌片 4／蛇片 2`，且約慢五倍。
7. **Fun-ASR-Nano-2512**：官方模型權重約 2.13 GB；本次冷下載 6 分 26 秒
   只完成約 622 MB（29%），已停止。這是尚未完成 accuracy test，不是模型
   品質不合格。
8. **直接 OpenAI `gpt-transcribe`**：目前程序環境與專案 `.env`沒有
   `OPENAI_API_KEY`；本輪只能測已配置的 Azure deployments，未把 Azure key
   誤當成 OpenAI API key。

## 歷史候選流程與完整驗證後修正

這支 regression audio 上，最有希望的不是「Azure 加一個文字 prompt」，而是：

1. Qwen3-ASR 1.7B 以 60 秒切片作主轉錄，不傳上一段模型輸出；
2. 每段先跑不含領域詞的 repetition／sparse gate；
3. repetition gate 失敗時，只把原音訊縮成 30 秒重跑；
4. 保存 provider raw text，再用既有 OpenCC `s2twp`做 display normalization；
5. diarize 只提供 speaker 證據，不覆蓋主文字；
6. 多 ASR 共識先保留為 review candidate，不直接寫回 raw text。

完整 5,609.520 秒實跑證明 repetition gate 與 30 秒重試確實能攔下並恢復
一個 Qwen HTTP 200 內容失敗。但原始影片同時證明，`舌片 7／蛇片 0`不能當
術語勝出證據；Qwen 完整輸出沒有任何 `Tray盤`。因此 Qwen 60 秒只能作
staging／shadow candidate，不能直接替換 production provider。完整數值、
視覺 context A/B 及 go/no-go 見上方連結。

正式替換 production provider 前，下一個必要驗證是用至少三場從未參與調參的
新會議，由人工 reference 同時計算：

- CER／字詞 substitution、deletion、insertion；
- 公司名、產品名、縮寫、數字與行動項目的正確率；
- repetition／sparse gate 的 false positive；
- 端到端延遲、GPU 記憶體與併發吞吐。

在沒有這組 blind evidence 前，Qwen 60 秒只能標為 staging candidate，不能把
單一 HDD regression 的勝出外推成所有會議都優於現行流程。

## 版本與原始實驗產物

- Azure：active deployment `gpt-4o-transcribe`，
  API version `2025-03-01-preview`
- speaker evidence：`gpt-4o-transcribe-diarize`
- faster-whisper `1.2.1`、CTranslate2 `4.8.1`
- `qwen-asr 0.0.6`、Qwen3-ASR 1.7B、PyTorch `2.13.0`
- FunASR `1.3.27`（僅完成環境安裝，accuracy test 未完成）
- GPU：NVIDIA RTX 5080 16 GB
- 原始 JSON：`/tmp/ai-notetacker-hdd.M1Xz3T/oracle-matrix-v1/results/`

`/tmp` JSON 含內部會議逐字稿，沒有加入 Git；本文件只保存聚合結果與音訊
雜湊。
