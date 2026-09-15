# 逐字稿說話者分辨（Speaker Diarization）研究與實測

> 研究日期：2026-09-09
> 音訊來源：正式環境既有資料 `job_4cecae8789b04e6da13944720282dd2a`
> （`hdd-reference.wav`，5,609.52 秒 / 16 kHz mono PCM / 171 MB），
> 即 `improve-uploaded-meeting-note-quality/benchmark.md` 的同一份盲測檔。
> 對照組：同一 job 已儲存的 `mai-transcribe-1.5` artifact（654 segments）。
> 實測共 11 次 Azure Speech request、約 4.7 音訊小時（估計 US$0.5–1.7）。
> 未把既有逐字稿、PLAUD 文字或檔名推測詞送給任何 model；
> 唯一一次 `phraseList` 測試明確標示為 operator-assisted，與 oracle-free 結果分開列。

## 結論

**`MAI-Transcribe-2` 在正式環境的 Azure Speech resource 上可用，diarization 實測 100% 覆蓋。**

| | 現況（mai-transcribe-1.5） | 實測（MAI-Transcribe-2） |
|---|---:|---:|
| 有 speaker 標註的段落 | **0%** | **100%**（256/256、51/51） |
| provider 真實時間戳 | **0 / 654** | **974 / 974** |
| 每場會議 request 數 | ~187（30 秒切片） | **4**（30 分切片） |
| 93.5 分鐘處理時間 | ~1 小時 | **15.6 秒／chunk**（115–205× realtime） |
| 單價 | US$0.36／小時 | **US$0.36／小時（同一 meter，見 §1.6）** |
| 文字量 | 基準 | 0.995×（幾乎相同） |
| 文字一致度 | — | 0.9252 |

2026-07-30 停做 Speaker 分類的三個理由（第二個 model、額外 683 秒、只蓋到
37.6%）**全部消失**，因為 MAI-2 在同一個 request 內同時產出文字與 speaker。

**但有一個確認的文字回歸**：MAI-2 把 `tray` 聽成 `tree`／`吹`（5 → 0），
而原始影片證據證實 `Tray盤` 是這場會議的官方詞彙。
**已驗證的解法**：MAI-2 支援 `phraseList`，加入 `Tray` 後 `tray` 從 0 回到 2、
`tree` 從 2 降到 0。專案已有 operator glossary 機制，目前刻意沒送給 MAI。

**建議：可以做，但把 `phraseList`（既有 glossary）一起接上，否則會用
`tray` 這種已知術語換 speaker。**

---

## 一、實測結果

環境：`ai-itadmin2753ai646968161520-sea-mai15`（Southeast Asia），
`api-version=2025-10-15`。工具：`scripts/probe_speaker_diarization.py`。

### 1.1 API 契約（實測修正官方文件）

實際可用的 definition：

```json
{
  "enhancedMode": {
    "enabled": true,
    "model": "MAI-Transcribe-2",
    "modelOptions": { "transcribeStyle": "verbatim", "timestamps": "word" }
  },
  "diarization": { "enabled": true }
}
```

- `transcribeStyle` 必須放在 **`enhancedMode.modelOptions`** 裡（現行 1.5
  的程式碼是放在 `enhancedMode` 下一層，換 model 時要一起改）。
- `diarization` 是 **top-level**，與 `enhancedMode` 同級。
- **`maxSpeakers` 不能用**：回 `HTTP 400 InvalidRequest —
  "maxSpeakers is not supported for MAI transcription yet."`
  （標準 fast transcription 支援 2–35，MAI 還沒有。）
- model 名稱大小寫 `MAI-Transcribe-2` 可用。

回傳的 phrase 欄位：
`speaker`（0-based int）、`offsetMilliseconds`、`durationMilliseconds`、
`text`、`locale`、`confidence`（開 `timestamps: word` 時另有 `words`）。

### 1.2 Diarization 有時長上限：介於 30 與 35 分鐘之間

| 音訊長度 | 結果 | 耗時 | phrases | speakers | speaker 覆蓋 |
|---:|---|---:|---:|---:|---:|
| 5 分 | ✅ | 3.6 s | 51 | 2 | 100% |
| 10 分 | ✅ | 5.2 s | 112 | 4 | 100% |
| 20 分 | ✅ | 9.2 s | 171 | 3 | 100% |
| 30 分 | ✅ | 11.3 s | 256 | 4 | 100% |
| 30 分 + word timestamps | ✅ | 15.6 s | 256 | 4 | 100% |
| 35 分 | ❌ | 33 s | — | — | — |
| 40 分 | ❌ | 36 s | — | — | — |
| 93.5 分（整檔） | ❌ | 40 s | — | — | — |

失敗一律是
`HTTP 503 — {"code":"diarization_unavailable","message":"Speaker diarization
service is unavailable: Diarization service returned error code 400"}`。

**這是 diarization 的限制，不是上傳的限制**——171 MB 的整檔上傳每次都在
30–40 秒內完成並收到回應。生產切片建議 **25 分鐘**（留餘裕）。

### 1.3 純轉錄（不開 diarization）可以吃整檔

| 設定 | 結果 | 耗時 | phrases | 時間戳 | 字元 |
|---|---|---:|---:|---:|---:|
| 93.5 分，不開 diarization | ✅ | 27.4 s | **1** | 1 | 29,599 |
| 93.5 分，`timestamps: "word"` | ✅ | 43.6 s | **974** | 974 | 29,576 |

**重要**：不開 diarization 又不開 timestamps 時，整檔只回**一個 phrase**
（一大坨文字，沒有分段）。`timestamps: "word"` 會把整檔切成 974 個有真實
offset 的 phrase，且**整檔不需切片**。

### 1.4 文字品質：整檔 93.5 分鐘對照既有 artifact

oracle-free（沒有 phraseList、沒有 locale、沒有前文）：

| 指標 | 既有 mai-transcribe-1.5 | MAI-Transcribe-2 |
|---|---:|---:|
| 段落數 | 654 | 974 |
| 正規化字元 | 24,825 | 24,705（**0.995×**） |
| 正規化 sequence similarity | 基準 | **0.9252** |
| provider 真實時間戳 | **0 / 654** | **974 / 974** |

術語計數（`raw` 欄位；1.5 的 `disp` 是 OpenCC + operator alias 後的結果）：

| 詞 | 1.5 raw | 1.5 disp | MAI-2 | 判讀 |
|---|---:|---:|---:|---|
| 舌片 | 31 | 33 | 8 | 兩者都不是影片證實的 `Tray盤` |
| 蛇片 | 9 | 6 | **34** | MAI-2 偏向 `蛇片` |
| 料盘／料盤 | 10 | 12 | 12 | 打平 |
| 条码／條碼 | 35 | 35 | 34 | 打平 |
| 硬碟／硬盘 | 13 | 18 | 17 | 打平 |
| MVS | 17 | 16 | 15 | 略少 |
| **Tray** | **5** | 10 | **0** | **回歸** |
| MES | 7 | 8 | 8 | 打平 |
| Google ID（已知錯誤） | 3 | 3 | **1** | MAI-2 較少犯 |

**確認的回歸**，4,429–4,440 秒：

```
1.5   : ...single tray 啊，還是 double tray。哦，那你 one tray 是左邊 tray 還是右邊 tray？
MAI-2 : ...single tree啊，還是 double tree啊？ 那你彎吹是左邊吹還是右邊吹？
```

同一段 MAI-2 也**多**抓到 1.5 完全漏掉的一句
（「還是說我們自己去做，他希望說有可以切單一邊作業的模式」）。
兩者互有得失，不能單向宣稱誰比較準。

### 1.5 `phraseList` 修好了這個回歸（operator-assisted）

同一分鐘音訊，唯一差異是加入
`"phraseList": {"phrases": ["Tray","MVS","MoveIn","GroupID","MES3"]}`：

| | `tray` | `tree` |
|---|---:|---:|
| 無 phraseList | 0 | 2 |
| 有 phraseList | **2** | **0** |

`彎吹／左邊吹／右邊吹` 仍未修正——phraseList 不是萬靈丹。
這是 operator-assisted 結果，不是 oracle-free 準確率證據。

### 1.6 價格：查證後**不是** $0.10，是同一個 $0.36 meter

用 Azure 官方 retail price API 查 `southeastasia` 全部 Foundry Tools／Speech
meter（2026-09-09）：

- **沒有任何 MAI-Transcribe 專屬的轉錄 meter。** 名稱含 `MAI` 的只有
  `MAI-DS-R1`、`MAI-Thinking-1`、`MAI-Cyber-1-Flash` 等 token 計價 LLM。
- 唯一的 fast transcription meter 是 `Fast Transcription Speech To Text`
  （`e366297b-9194-5c2f-91f9-2b6472d890b3`）**US$0.36／小時**，
  就是本專案現在用的那個。
- 報導的 US$0.10／小時是 Microsoft 公告的促銷價，**retail API 裡看不到**，
  無法在帳單出現前證實。本系統的計價 catalog 因此維持 $0.36。

所以換 MAI-2 的**單價不變**。實際費用差異只來自 request 結構：

| 影響 | 方向 | 大小 |
|---|---|---|
| 每個 chunk 進位到整秒（187 → 4 個 chunk） | 省 | 每場 < 3 分鐘，可忽略 |
| 25 分切片的 3 分鐘重疊（只影響 > 25 分的會議） | 多 | 每個接縫 +3 分鐘 |
| Diarization 本身 | 無 | file-based 不加價 |

以正式環境 142 場的長度分布估算：78% 會議 < 25 分鐘**完全不變**；
80 分鐘的會議 = 4 chunk、3 個接縫 → 多 9 分鐘 → **US$0.48 → US$0.54**。
全部歷史 38.1 小時套用新規則約 +3.2 小時，**約 +US$1.1（+8%）**。

### 1.7 實作後端到端驗證：80.8 分鐘真實會議

`job_6f2809fc17e0494c9a2ca14db4657601`（`錄製_2026_09_09_11_02_02_324.mp4`，
80.8 分鐘，雙語）以 25 分鐘切片＋重疊跑完整管線：

| 重疊 | 各 chunk speakers | 合併後標籤數 | 接縫連結率 |
|---:|---|---:|---|
| 60 秒 | 4／4／6／6 | 15 | 1/4、2/6、2/6 |
| 300 秒 | 4／3／5／6 | 10 | 2/3、2/5、3/6 |

**接縫是已知弱點**：重疊區裡沒開口的人無法用時間對應，會拿到新標籤。
真實人數估計 4–6 人。生產設定採 3 分鐘重疊（成本 +8%）；
改名 UI（Phase 3）是把多餘標籤合併的保底手段。

同檔另測 diarization 上限：40 分 ✅✅、50 分 ✅、60 分 ❌、70 分 ❌、
80.8 分 ❌❌❌（`HTTP 500 InternalServerError`）。
與 HDD 檔（30 ✅、35 ❌）合看，**上限依檔案而異**，25 分鐘是兩者都安全的值。

### 1.8 Speaker 品質抽查

30 分鐘 chunk，4 個 speaker：

| speaker | phrases | 說話時間 | 佔比 |
|---:|---:|---:|---:|
| 0 | 113 | 941.7 s | 58.6% |
| 1 | 51 | 212.5 s | 13.2% |
| 2 | 17 | 44.2 s | 2.7% |
| 3 | 75 | 409.4 s | 25.5% |

實際內容（677–872 秒節錄，S0 與 S3 為主要對話者）：

```
[  680.5s] S3  OK，OK，那就對了…那這邊有一個要跟你更正的…
[  747.5s] S0  謝謝，我聽懂，所以就是
[  749.3s] S3  嗯。
[  750.0s] S0  我們剛剛系統就是人員透過 UI 界面啟動的部分…
[  763.2s] S3  對。
[  763.3s] S0  你的軌道才能做 initial。
[  765.2s] S3  對，對，這個是保護你們的那個機殼的一個安全。
[  769.8s] S0  謝謝你，那這個我會後我會弄這個下來，感謝你。
[  804.2s] S1  應該是按之前就可以。
[  805.5s] S3  對，應該是我們在系統。
```

問答節奏自然，連 0.1 秒的「嗯」「對」都正確歸屬。
run-length 分布為 248 個長度 1、4 個長度 2——**phrase 邊界本身就是說話者輪次**，
這是設計行為不是錯誤。

已知限制：同一段 600–900 秒音訊，5 分鐘視窗只分出 2 人，10／30 分鐘視窗分出
4 人，PLAUD 在該視窗有 4 個標籤。**視窗越短越容易併人**，這也是選 25–30 分鐘
切片而非更短的另一個理由。

---

## 二、專案現況（程式碼證據）

### 目前完全沒有說話者資訊

| 層 | 現況 | 位置 |
|---|---|---|
| MAI 回應解析 | 只取 `text` 與 `locale`，**丟掉整個 `phrases` 陣列** | `mai_transcriber.py:203-239` |
| 時間戳 | 因為沒有 `segments`，全部走 `timing_source="estimated"` | `azure_openai_transcriber.py:399-419` |
| Artifact 輸出 | `_to_artifact_segment` 欄位表**沒有** `speaker` | `worker_loop.py:62-79` |
| 閱讀畫面 | `Speaker A` 一律改寫成「與會者」 | `public/artifact-reader.js:13-14` |
| 分享 DTO | `sanitizeAnonymousSpeakerLabels` 抹除標籤 | `src/domain/meeting-share.ts:25-26` |
| 摘要 prompt | 主動剝掉 `Speaker X：` 前綴 | `transcript_summary.py:123-124` |
| glossary | 有 `transcriptionGlossary`，但**沒送給 MAI**（刻意省略 `phraseList`） | `use-mai-luna-transcription-pipeline/design.md:35-38` |

### 但資料契約還留著

control-plane 的 zod schema **已經接受** speaker 欄位，不需要新增 schema：

```ts
// apps/control-plane/src/app.ts:269-298
speaker: z.string().min(1).optional(),
speakerSource: z.string().min(1).optional(),
speakerAlignmentScore: z.number().min(0).max(1).optional(),
```

`azure_openai_transcriber.py` 的 base class 也**已經有** provider-timing 分支
（`_payload_to_transcript_result` 在 payload 有 `segments` 時走
`timing_source="provider"`）。MAI adapter 只是從來沒有填它。

**這是「接回既有管線」，不是「蓋新管線」。**

### 正式環境資料量

| 項目 | 數量 |
|---|---:|
| 總 job | 180（142 completed、38 failed） |
| 不同 submitter | 62 |
| 期間 | 2026-03-31 ～ 2026-09-09 |
| MAI-1.5 完成的 job | 70（20.56 音訊小時） |
| 其他 provider | gpt-4o-transcribe 34、whisper 24、4o-mini 6 |
| 物件儲存 | 5.9 GB |
| **仍帶歷史 speaker metadata 的 job** | **4**（含兩份 93.5 分鐘 HDD 基準檔） |

---

## 三、歷史：做過，然後決定拿掉

`benchmark.md` 的原始做法是 hybrid：`gpt-4o-transcribe` 當唯一文字來源，
`gpt-4o-transcribe-diarize` 另跑一趟只當 speaker 證據，再用時間對齊。

| 指標 | 當年 hybrid | MAI-1.5 live job | **今日 MAI-2 實測** |
|---|---:|---:|---:|
| 有標到 speaker 的段落 | 446/1,186（37.6%） | 399/658（60.6%） | **100%** |
| 穩定匿名 reference | 4（provider 上限） | 3 | 4／30 分 chunk |
| 額外耗時 | 683 秒、19 request | — | **0**（同一 request） |
| 對 PLAUD local 一致度 | 87.4% | — | 未測 |

**當年失敗的不是「分不出說話者」，是覆蓋率、上限與成本。**
一致度 85–87% 其實可用。HANDOFF.md:8 的決定就是基於這個。

---

## 四、自問自答（grill）

### Q1. 這功能該存在嗎？還是 YAGNI？

**該存在。** `add-autonomous-meeting-recorder/design.md:122` 當年就列為 open
question，PLAUD 比較表裡 speaker 一直是本專案唯一明顯落後的維度
（PLAUD 100% 標註 vs 本專案 0%），而且使用者直接提出。

### Q2. 為什麼不直接在現在的 request 加一行 `diarization: enabled`？

**因為 MAI-1.5 不支援，而且 30 秒切片會讓它失效。**

`MAI_CHUNK_DURATION_MS = 30_000`（`mai_transcriber.py:15`）。Azure 的
`speaker` 是那一次 request 內的索引，不是跨檔案身分。1.5 小時的會議會切成
~187 個 request，每個都從 speaker 0 重新編號，而且 3 個 thread 亂序併發。

這正是 2026-07 那版要另外做「跨 chunk anonymous reference 延續」的原因，
也是它只有 37.6% 覆蓋率的原因。

### Q3. 為什麼當初要切 30 秒？現在能拿掉嗎？

不是 API 限制，是**網路穩定性的權宜之計**
（`use-mai-luna-transcription-pipeline/design.md:11`：60 秒 PCM 上傳曾被 reset）。
同一份文件 line 99 寫明「the boundary can be revisited only with **measured**
larger-upload reliability」。

**今天量到了：171 MB 整檔上傳連續 5 次全部成功，30–44 秒完成。**
30 秒切片可以拿掉。

### Q4. 那切多長？

**25 分鐘。** 實測 30 分可、35 分不可，25 分留一個 chunk 的餘裕。
93.5 分鐘的會議 = 4 個 chunk（今天是 187 個）。

### Q5. 4 個 chunk 之間的 speaker 編號怎麼接？

三個接縫的問題，不是 186 個。三種做法由懶到不懶：

1. **切片重疊 60 秒**：重疊區兩個 chunk 都有標，看哪些標籤在同一時間出現，
   貪婪配對即可。純算術，不需要額外 request、不需要 embedding。**建議先做這個。**
2. **整檔文字 + 分段 speaker**：一次整檔 `timestamps: word` 拿權威文字
   （974 phrase，**文字完全沒有接縫**），再 4 次 25 分 diarization 只拿
   speaker 時間軸，用 offset 對齊。文字更乾淨，但音訊時數計費 ×2
   （1.5 小時會議 $0.31 vs $0.16，仍比現在的 $0.56 便宜）。
3. **人工改名**：反正最後都要讓人把 Speaker 1 改成名字，接縫錯了人也看得出來。

### Q6. 換成 MAI-2 會不會讓文字倒退？

**整體不會，但單點會，而且已經量到了。**

整檔 0.995× 字數、0.9252 一致度，沒有大量遺漏。
但 `tray` 5 → 0（變成 `tree`／`吹`），`舌片` 31 → 8、`蛇片` 9 → 34。

`tray` 是唯一有**原始影片硬證據**的詞（影片畫面可見 `Input Tray Setting`），
所以這是真回歸。**`phraseList` 已實測可修**（tray 0→2、tree 2→0）。

`舌片`／`蛇片` 兩者都不是影片證實的 `Tray盤`，不能拿來當誰比較準的證據。

### Q7. 那 `phraseList` 該不該開？當初為什麼刻意不開？

當初不開是為了**盲測純淨**——不能把答案餵給 model 再宣稱它很準
（`design.md:36-38`：「They omit `phraseList` and `locales`」）。

但那是**benchmark 的規則，不是產品的規則**。產品面：
- `transcriptionGlossary` 是 operator 自己輸入的詞彙，本來就是產品功能；
- 它已經在 job payload 裡傳到 worker（`worker_loop.py:246`）；
- 現在只被拿來做**事後**的 display alias 替換與 review flag，
  沒有在**事前**幫 ASR 聽對。

**建議：把 accepted glossary term 送進 `phraseList`。** 這同時修好 `tray`
回歸，也讓現有 glossary 功能真正發揮作用。未來 benchmark 仍應同時跑
oracle-free 與 assisted 兩組，分開報告。

### Q8. 自架（pyannote / NVIDIA）比較好嗎？

**不好。**

- 本機 GPU 已被 `faster-whisper large-v3` 佔著，rollout profile 只規劃 1 張卡。
- pyannote community-1 是最好的開源選項（speaker confusion 比 3.1 少一半、
  不限人數）；NVIDIA Sortformer **上限 4 人**、以英文為主。
- 但自架只解決「分群」，還要自己做時間對齊回 MAI 文字——又回到 37.6% 覆蓋率。
- MAI-2 是 ASR 與 diarization 在同一個 model 內，**實測 100% 對齊、0 秒額外耗時**。

只有在「不能把音訊送雲端」時自架才值得。本專案已在用 Azure，前提不成立。

### Q9. 匿名 `Speaker 0/1/2` 夠嗎？

**不夠，但它是必要的第一步。** 使用者要的是「這句話是誰說的」，
`Speaker 0` 只回答「至少不是同一個人」。

不過有了穩定分群，取名字就從「一句一句判斷」變成「一場會議決定 3–5 個名字」。

### Q10. 真名從哪來？

| 做法 | 成本 | 準確度 | 評價 |
|---|---|---|---|
| **人工改名 UI**（Speaker 0 → 王經理，全場套用） | 極低 | 100% | **一定要做**，唯一保底 |
| **LLM 從內容推斷**（自我介紹、被叫名字） | 幾乎為零 | 中，不可靠 | 摘要 worker **已經**讀整份逐字稿，在既有 prompt 加一段輸出建議即可，**不需新 request**。當**預填值**不當事實 |
| **Meeting bot 參與者名單** | 中 | 高（限每人各自裝置） | 只對 meeting-link job 有效；會議室共用麥克風無效。需先查 ScreenApp API |
| **聲紋註冊**（Azure Speaker Recognition） | 高 | 高 | 生物特徵儲存、隱私合規問題。**不建議** |

**建議組合：人工改名 UI ＋ LLM 建議值。**

### Q11. 前端要改多少？

比想像少。抹除邏輯是**故意加的**
（`deepen-meeting-note-navigation` spec 明訂「public transcript omits stored
speaker metadata」）。

要做的是**依 schema 版本分流**：歷史 artifact（v2）維持現狀，
新 artifact（v3）才顯示。不用重跑任何舊資料。
`sanitizeAnonymousSpeakerLabels` 要保留——它處理的是**摘要文字裡**殘留的
`Speaker A` 字串，那個問題不會消失。

### Q12. 驗收門檻？

1. **文字不能退步**：對 MAI-1.5 既有 artifact 盲比對，similarity ≥ 0.92、
   字數 ≥ 0.98×，且 `Tray`／`MVS`／`條碼` 不得低於現況。**（本文已量到基準）**
2. **覆蓋率 > 95%**：實測 100%，門檻應該過得很輕鬆。
3. **時間戳**：`timing_source=provider` 比例應接近 100%（現況 0%）。
4. **接縫**：跨 chunk 標籤對應正確率，用重疊區驗。
5. **穩定性**：25 分鐘 chunk 連續 N 次不失敗。

**不要用「對 PLAUD 的一致度」當準確率。** PLAUD 不是 ground truth。

### Q13. MAI-2 是 preview，可以上正式嗎？

風險真實但可控：
- 專案**已有** operator 可選 provider 機制，1.5 保留為 fallback 是零成本的。
- 促銷價 2026-12-31 到期，之後未公布。即使回到 $0.36 也只是打平現況。
- preview 契約可能變更——`maxSpeakers` 的錯誤訊息寫著 "not supported **yet**"，
  代表這個 API 還在動。

### Q14. 需要 OpenSpec change 嗎？

**需要。** 同時碰到 provider 預設、artifact schema、public DTO 契約與計價 meter，
而且 `deepen-meeting-note-navigation` 的「public transcript omits stored speaker
metadata」是**已生效的 spec**，要改必須走正式 delta。

---

## 五、建議路線

### Phase 1 — 轉錄管線（程式改動很小）

| 檔案 | 改動 |
|---|---|
| `mai_transcriber.py` | model 改 `MAI-Transcribe-2`；`transcribeStyle` 移進 `enhancedMode.modelOptions` 並加 `timestamps: "word"`；definition 加 top-level `diarization: {enabled: true}`；**不要**加 `maxSpeakers` |
| `mai_transcriber.py::_normalize_transcription_payload` | 把 `phrases[]` 映成 `segments[]`（`start`／`end` 秒 + `speaker`），不要再 join 成一坨 text |
| `mai_transcriber.py::_build_request_prompt` 附近 | accepted glossary term → `phraseList.phrases` |
| `MAI_CHUNK_DURATION_MS` | `30_000` → `1_500_000`（25 分），並加 60 秒重疊 |
| `MAI_MAX_WORKERS` | 3 可保留（4 個 chunk 併發） |
| `azure_openai_transcriber.py` | `_payload_to_transcript_result`／`_build_evidence_segment` 把 `speaker` 帶下去 |
| `worker_loop.py::_to_artifact_segment` | 加一行 `("speaker", "speaker")`；artifact 標 `schemaVersion: 3` |
| 新增 | 重疊區 speaker 標籤配對（跨 chunk 對應） |
| control-plane | **不用改 schema**，已經接受 speaker |

base class 既有的 provider-timing 分支會自動接手，順便把 `timing_source`
修成 `provider`。

### Phase 2 — 顯示出來

依 `schemaVersion` 分流：v3 顯示 speaker，v2 維持現狀。
`artifact-reader.js`、`meeting-share.ts`、匯出（Markdown／TXT／SRT）同一套判斷。
需要 OpenSpec delta 改 `meeting-content-sharing` 的 no-speaker 契約。

### Phase 3 — 取名字

1. 逐字稿頁加「改名」：Speaker 0 → 自訂名稱，存 job 層級對應表，全場套用。
2. 摘要 prompt 加一段：有明確稱呼證據時輸出 `Speaker N → 名字` 建議清單，
   當**預填值**不當事實。不新增 model request。

### 實作與部署紀錄（2026-09-09）

operator 決定直接全面改用，未先跑 70 個舊 job 的批次盲比對；該比對仍可用
`scripts/probe_speaker_diarization.py` 事後補跑。

| 項目 | 結果 |
|---|---|
| Phase 1 轉錄管線 | 已實作：`MAI-Transcribe-2`、25 分切片＋3 分重疊、無損 WAV 上傳、diarization 失敗自動退回純轉錄、glossary → `phraseList`、artifact `schemaVersion: 3` |
| Phase 2 顯示 | 已實作：依說話者分段、發言占比列；v2 歷史 artifact 維持不顯示 |
| Phase 3 改名 | 已實作：`PUT /api/operator/jobs/:id/speakers`，名稱存在 `transcriptArtifact.speakerNames`，segment 保留 provider 標籤當證據；套用到 owner 閱讀頁、分享頁 DTO、Markdown／TXT／SRT 匯出。摘要 prompt 維持不含 speaker（沿用 2026-07-30 決定） |
| 部署 | `10.1.2.158`：`.env` 改 `AZURE_SPEECH_MAI_MODEL=MAI-Transcribe-2`，`scripts/deploy.sh up control-plane transcription-worker`；`.env` 備份為 `.env.bak.<timestamp>` |
| 部署後 smoke | `job_b2990b7669b749be857bc20206b593ff`（4 分鐘 HDD 片段，submitter `claude-smoke-check`）：latched `MAI-Transcribe-2`，10 秒完成，schemaVersion 3，40/40 segment 有 speaker（3 人）、40/40 provider 時間戳 |
| 部署中發現並熱修 | control-plane zod 原本只接受 `schemaVersion: 2`，會把 v3 打回 400；已改為 `2 \| 3` 並重建 control-plane |
| 測試 | worker 136（3 個既有失敗與本次無關）；control-plane 359 通過（8 個既有 CRLF 失敗與本次無關）；`tsc` 通過 |

計價：`cloud-usage.ts` 接受 `mai-transcribe-1.5` 與 `MAI-Transcribe-2` 走同一個
$0.36 meter，否則 MAI-2 工作會變成 `unpriced`。

### 上線後第一場真實會議：接縫是主要誤差來源

operator 把當天 80.8 分鐘的會議（`job_6f28…`，部署前用 1.5 轉的）重送為
`job_6c80baab71ff465f872b22eb3521d847`：30 秒完成、471 段全部有 speaker、
全部 provider 時間戳，但出現 **10 個標籤**。依 25 分鐘切片視窗拆開看：

| 切片 | 該視窗內活躍標籤 |
|---:|---|
| 0 | Speaker 1, 2, 3, 4 |
| 1 | Speaker 1, 3, 4, 5 |
| 2 | Speaker 1, 3, 5, 6, 7 |
| 3 | Speaker 5, 7, 8, 9, 10 |

**每個切片內只有 4–5 個標籤**（接近實際人數）；6、7、8、9、10 全是後段切片
新產生的，即重疊區裡沒開口、無法用時間對應的人。所以 operator 感受到的
「分類不準」主要是**跨切片接縫**，不是切片內的模型錯誤。

已交付的補救：owner 頁每段有播放鈕（`GET /api/operator/jobs/:id/media`
支援 byte range，瀏覽器可直接 seek），聽完用「套用姓名」把同一人的標籤填同名即可合併。

**切片內也有併人錯誤**：operator 指出 0:00 與 1:04 兩段（原始都是
`Speaker 1`）與 4:23（原始 `Speaker 2`）是不同的人。判讀是遠端與會者共用
同一路會議音訊，模型把音色相近的人併成一個標籤；5 分鐘視窗實測反而併得更多，
所以縮短切片無法改善，MAI 也不接受 `maxSpeakers`。

補救：每段旁的原生 `<select>` 可把整個 turn 改成既有的人或「＋ 新的說話者」；
存在 `transcriptArtifact.segmentSpeakers`（segment index → label），segment 本身
仍保留 provider 標籤。閱讀頁、分享頁 DTO、匯出與發言占比都以覆寫後的標籤計算。
目前為整個 turn 一起改；同一 turn 內混兩人的情況需拆到單行，尚未做。

**上線後抓到一個會掉內容的 provider 行為（已修）**：67.2 分鐘會議
`Video_2026-09-07_150815.mp4` 的中間切片（1320–2820 秒）API 回 320 個 phrase，
**每個 phrase 的 `offsetMilliseconds` 與 `durationMilliseconds` 都是 0**，但
`words[]` 的時間正確（160 ms～1,494,440 ms）。原本的合併邏輯把它們全視為
落在切片開頭的重疊區而丟掉，成品少了 23.5～44 分鐘。修法：phrase 時間為空時改用
第一個字／最後一個字推算（`MaiTranscriber._phrase_timing_ms`），並在
`_merge_part_segments` 加保險——修剪重疊絕不把整個切片清空。重跑後 853 段、
最大間隔 1.3 分鐘；受影響的重跑成品已刪除並以新工作取代。掃描其他 MAI-2
工作沒有同樣的洞。

**後台結果頁與前台共用同一個閱讀器**：`renderArtifactReader`／`wireArtifactReader`
搬到 `public/artifact-reader.js`，owner 頁（`app.js`）與 `/admin/result`
（`share.js` admin 模式）都呼叫它；差別只在媒體與改名走 `/api/admin/jobs/:id/media`
（`<audio>` 無法帶 header，改以 `?token=` 帶 console session token）與
`/api/admin/jobs/:id/speakers`。公開分享頁仍是唯讀。

結構性修法（尚未做，需 operator 決定）：先用較長切片（本檔 50 分鐘可過），
diarization 失敗時把該切片對半重試；80 分鐘會議從 3 個接縫降到 1 個。
代價是失敗時多一次上傳，且 `_merge_part_segments` 需支援巢狀切片分組。
真正的解法是跨切片聲紋比對（speaker embedding），見下一節。

## 八、業界／開源怎麼解（2026-09-09 查證）

### 8.1 標準做法：ASR 給字級時間戳，diarization 另跑整檔，再用時間重疊對回去

[whisperX](https://github.com/m-bain/whisperX) 是最常被引用的開源管線：
faster-whisper 轉文字 → wav2vec2 對齊出**每個字的時間** → pyannote 對**整檔**做
diarization → `assign_word_speakers` 把每句／每個字指派給**重疊時間最長**的
speaker（用 interval tree 查詢，沒有重疊時 `fill_nearest` 取最近的一段）
（[diarize.py](https://github.com/m-bain/whisperX/blob/main/whisperx/diarize.py)）。

本專案 2026-07 那版 hybrid 只蓋到 37.6%，根本原因是當時文字沒有真實時間戳
（按字數平均分配）。**MAI-Transcribe-2 現在有字級時間戳**，whisperX 這種對法
在本專案已經可行——這修正了本文 Q7 早先「自架不划算」的判斷。

### 8.2 跨切片一致性：靠聲紋 embedding 分群，不是靠時間重疊

文獻裡長錄音的做法一律是：每個切片的每個 local speaker 抽一個 speaker
embedding（WeSpeaker ResNet34、CAM++、ECAPA 等），再對所有切片的 embedding 做
constrained clustering 得到全域身分（EEND-VC；DiariZen 用 VBx clustering）
（[Benchmarking Diarization Models](https://arxiv.org/html/2509.26177v1)、
[DiariZen tutorial](https://arxiv.org/html/2604.21507)）。
本專案現在用「重疊區同時出現」配對，是這個做法的弱替代品——重疊區裡沒開口的人
就配不上，正是 80 分鐘會議多出 5 個標籤的原因。

pyannote 與 DiariZen 都直接吃整檔（內部自己滑動視窗＋分群），**沒有 30 分鐘限制、沒有接縫**。

### 8.3 模型選擇（中文會議 benchmark，DER 越低越好）

| 模型 | AISHELL-4（中文會議） | AliMeeting（中文遠場） | 授權 | 備註 |
|---|---:|---:|---|---|
| [pyannote community-1](https://huggingface.co/pyannote/speaker-diarization-community-1) | 11.7% | 20.3% | CC-BY-4.0（需 HF token） | `exclusive_speaker_diarization` 專為對回 ASR 設計；可給 `min/max_speakers` |
| [DiariZen Large-s80-v2](https://github.com/BUTSpeechFIT/DiariZen) | 10.1% | **10.8%** | 程式 MIT，**權重 CC BY-NC**（非商用） | 目前開源最強，但授權不能用在公司產品 |
| [FunASR CAM++ pipeline](https://www.funasr.com/en/blog/funasr-speaker-diarization.html) | — | — | Apache-2.0 | 阿里中文導向，自動決定人數，可 CPU |
| [3D-Speaker](https://github.com/modelscope/3D-Speaker)（CAM++／ERes2Net） | — | — | Apache-2.0 | 20 萬中文說話者訓練的 embedding，適合做 8.2 的跨切片分群 |
| MAI-Transcribe-2（現用） | 未公布 | 未公布 | 雲端 | 單 request ≤ 25–50 分鐘、無 `maxSpeakers`、本檔切片內 4–5 人 |

NVIDIA Sortformer 上限 4 人、以英文為主，不列入。

### 8.4 LLM 事後修正（DiarizationLM）

Google 的 [DiarizationLM](https://arxiv.org/abs/2401.03506) 把「ASR 文字＋speaker
標籤」壓成文字丟給 LLM 重新指派標籤，Fisher 資料集 WDER 相對降 55.5%、
Callhome 降 44.9%——**但用的是微調過的 PaLM 2**；
[LLM-Diarize-ASR-Agnostic](https://github.com/GeorgeEfstathiadis/LLM-Diarize-ASR-Agnostic)
同樣需要微調。本專案已有 Luna／Codex 摘要管線，可以低成本試「零樣本」版本
（例如「回答問題的人不會是提問的人」這類語意線索），但沒有文獻證明零樣本有效，
只能當實驗。

### 8.5 對本專案的建議路線

1. **文字與時間戳維持 MAI-Transcribe-2**（整檔單 request、字級時間戳、$0.36/hr）。
2. **speaker 改由 GPU 主機跑 pyannote community-1 對整檔**（現在 GPU 只有
   Whisper fallback 在用，平時閒置），輸出 `exclusive_speaker_diarization`。
3. **指派**照 whisperX：每個 MAI phrase 取重疊最長的 speaker；沒有重疊取最近。
   MAI 自己的 diarization 保留為 pyannote 失敗時的 fallback。
4. 可讓 operator 在上傳時填「大約幾個人」→ `min/max_speakers`，這是 pyannote
   有、MAI 沒有的旋鈕，對「兩個人被併成一個」最直接。
5. 驗收用同一場 80 分鐘會議：標籤數應接近實際人數（現在 10），並用 operator
   已改名／改指派的段落當人工 reference 算一致率。

不建議：DiariZen（授權）、Sortformer（4 人上限）、聲紋註冊（隱私）。
LLM 修正列為選配實驗。

---

## 六、風險

| 風險 | 影響 | 緩解 |
|---|---|---|
| **`tray` 類術語回歸** | 已知詞彙聽錯 | **已驗證**：接上既有 glossary → `phraseList` |
| Diarization ≤ 30 分限制 | 需要切片與接縫處理 | 25 分切片 + 60 秒重疊配對 |
| 短視窗併人（5 分鐘只分出 2 人） | 短會議 speaker 偏少 | 切片不要小於 25 分鐘 |
| MAI-2 是 public preview | 契約可能變更（`maxSpeakers` 已見 "yet"） | 1.5 保留為 operator fallback（機制已存在） |
| 促銷價 2026-12-31 到期 | 成本不可預期 | 到期前重評；回到 $0.36 也只是打平 |
| 計價 meter 未確認 | 帳單可能不是 $0.10/h | **待辦**：上線前查 Azure 實際 meter |
| 匿名標籤又被嫌沒用 | 重蹈 2026-07 覆轍 | **Phase 3 改名 UI 是驗收條件，不是 nice-to-have** |
| 舊 artifact 混入低品質標籤 | 閱讀體驗倒退 | schemaVersion 分流，不回填舊資料 |

---

## 七、尚未驗證

- **Azure 實際計費 meter**：$0.10/hr 是公開報導價，本次未查帳單。
- **跨 chunk 重疊配對**：方法論已定，未實作也未量測。
- **20.56 小時批次盲比對**：本次只跑了 1 份基準檔。
- **其他語言**：只測了中文（回傳 locale 混有 `zh` 與 `yue`）。
- **ScreenApp meeting bot 是否提供參與者名單**：未查。

## 九、第二輪（2026-09-09 晚）：整檔本機 diarization 取代切片標籤

operator 在 `job_6d6744ff6b344af09d4ea855aabed1da`（67.2 分鐘、853 段、9 個標籤）
回報「分類依舊不夠準」。重新查證 2026-09 的雲端與開源現況後，改成 §8.5 的做法。

### 9.1 查證結果（雲端沒有開關能修）

| 問題 | 雲端現況（2026-09-09 查證） |
|---|---|
| `maxSpeakers` | MAI-Transcribe-2 文件（2026-09-03 更新）只有 `diarization.enabled`；batch transcription 有 `maxSpeakers` 2–35 與 240 分鐘上限，但沒有文件說 MAI 模型可用於 batch |
| diarization 長度上限 | 官方未記載；只有 300 MB 檔案上限。Gemini 3.5 Transcribe 開 diarization 也限 30 分鐘 |
| 同聲道相近聲音併人 | 每家 DER 都在 8–40%，沒有廠商宣稱能解 |
| 新模型 | 沒有 MAI-Transcribe-3／2.5；OpenAI 2026-07 的 `gpt-transcribe` 不含 diarization |

開源側：pyannote **community-1**（2025-09-29，CC-BY-4.0，AISHELL-4 DER 11.7%）
仍是最新開放 pipeline；官方鏡像 `pyannote-community/speaker-diarization-community-1`
**不需要 HF token**（`gated=False`，原 `pyannote/` 命名空間仍 gated）。
NVIDIA Sortformer 全系列硬上限 4 人（5–9 人 DER 15%→41%）；DiariZen 權重授權
不一致（GitHub 說 CC BY-NC）；3D-Speaker／FunASR CAM++ 為 Apache-2.0 備選。

### 9.2 實測（同一場 67.2 分鐘會議，RTX 5080，GPU 0 只剩約 2 GB 可用）

| 方案 | 說話者數 | 耗時 | 備註 |
|---|---:|---:|---|
| 現況：MAI 25 分切片 + 重疊配對 | 9 | — | 每個切片內只有 3–5 個標籤，接縫產生 6、8、9、10 |
| sherpa-onnx（pyannote seg-3.0 + 3D-Speaker CAM++/ERes2Net，FastClustering） | **176–265** | 141–193 s（CPU） | 過度分裂，不可用 |
| pyannote community-1，預設 batch 32 | — | — | CUDA OOM（需要 >2 GB） |
| **pyannote community-1，batch 8** | **8** | **119.9 s**（34× 即時）、GPU 峰值 **1.06 GB** | 採用 |

對照 MAI 切片內標籤（切片內的 MAI 標籤本身是可靠的）：

| 切片 | MAI 標籤 → pyannote 全域說話者（依秒數） |
|---|---|
| 0 | S1→spk0 539s、S2→**spk7** 308s、S3→spk1 319s |
| 1 | S1→spk0 509s、S3→spk1 99s、S4→**spk7** 117s、S5→spk5 218s、S6→spk3 132s |
| 2 | S1→spk0 577s、S6→spk4 326s、S8→**spk7** 113s、S9／S10 只有幾秒 |

MAI 的 Speaker 2／4／8 是同一個人（spk7），正是接縫造成的碎片；pyannote 一次就接起來。
切片內被拆到別的標籤的語音 **7.3%**、同一切片內併到不同 MAI 標籤的 **3.2%**——
也就是 pyannote 有零星的短句歸屬錯誤（例如 2757 秒主持人點名那句），但整場一致性遠勝。

### 9.3 實作（transcription worker）

| 檔案 | 改動 |
|---|---|
| `local_diarization.py`（新） | `PyannoteDiarizer`（ffmpeg 解碼 → 記憶體波形 → pipeline；batch 8；CUDA OOM 自動退回 CPU；優先取 `exclusive_speaker_diarization`）；`assign_speaker_turns`：每段取重疊最長的 turn，沒有重疊取最近（whisperX 做法） |
| `worker_loop.py` | 轉錄完成後、只要段落有真實時間戳就跑整檔 diarization，重新編號成 `Speaker N`，`speakerSource=local-diarization`；任何失敗都保留 provider 標籤 |
| `main.py`／`config.py` | `DIARIZATION_MODEL`（空字串停用）、`DIARIZATION_DEVICE`（auto／cuda／cpu） |
| `Dockerfile` | torch 2.11.0+cu128（RTX 50 需要 sm_120）、pyannote.audio 4.0.7；權重約 32 MB，第一次使用時下載進既有的 Hugging Face cache volume；image 3.4 GB → 10.9 GB |
| control-plane | 閱讀器、分享 DTO、改名 API 原本只認 `provider-diarization`，改為同時接受 `local-diarization` |
| `scripts/deploy.sh` | 新增 `build` 動作（只 build 不 recreate） |

MAI 自己的 diarization 仍開著：它是本機 diarization 失敗時的 fallback，也是切片內對照證據。

### 9.4 部署與驗證（2026-09-09 19:00 Asia/Taipei）

| 項目 | 結果 |
|---|---|
| 測試 | worker 144 個（3 個既有失敗：codex summarizer ×2、compose 需 docker），control-plane `tsc` 通過、vitest 371 通過（8 個既有 CRLF 失敗） |
| 部署 | `10.1.2.158`：`scripts/deploy.sh build` 後 `up --no-build control-plane transcription-worker`；部署時無進行中工作。回滾用舊 image：worker `e2f5e59b5b41`、control-plane `78fab498a02f` |
| 目標 job 回填 | `job_6d6744ff…` 以正式模組重算（119.6 s）後直接更新 DB：9 → **8** 個標籤、442/853 段改標、全部 `local-diarization`；原 artifact 備份在主機 `/home/solomon/Andy/diar-exp/job_6d67.transcript*.json` |
| smoke | `job_67fdfecb60704ab59489143a3f9798d9`（同會議 600–840 秒、4 分鐘、submitter `claude-smoke-check`）：MAI 約 20 秒，diarization 含首次下載權重約 52 秒，54 段 `local-diarization`，主要 4 人（110／42／21／14 秒）＋3 個零星短標籤（<3 秒），與整檔結果同一視窗一致 |
| 程式狀態 | 本機與主機皆為未 commit 的工作樹變更（未獲 commit／push 授權） |

### 9.5 尚未做／已知限制

- 同一段話裡換人（MAI 一個 phrase 混兩人）仍歸給重疊較長的人；需要字級時間戳才能拆。
- 沒有把 operator 的「大約幾個人」接到 `min_speakers`／`max_speakers`（pyannote 支援），
  這是「兩人被併成一人」最直接的旋鈕，需要上傳表單與 job payload 改動。
- CPU fallback 很慢（實測 12 執行緒跑同一檔超過 40 分鐘仍未完成，與其他實驗同時競爭 CPU）；
  GPU 0 的可用記憶體受主機上 `llama-server` 佔用影響，低於 1.1 GB 就會退回 CPU。
- 混合做法（保留 MAI 切片內的逐句歸屬，只用 pyannote 決定跨切片身分）可以再降低零星
  短句錯誤，但無法拆開 MAI 在切片內併掉的人；本輪採純 pyannote 指派。

## 十、第三輪（2026-09-10）：驗證推翻了「整檔取代」，改為混合指派

第二輪上線後做了一次 92 個 agent 的獨立驗證（真實付費重跑、獨立聲紋模型、
盲測 A/B、API/失敗路徑/程式碼/回歸），結論是**整檔 pyannote 直接取代 provider
標籤是錯的**，必須改成混合。

### 10.1 端到端確實可跑（部署後真實重跑）

`job_6f59b1b0bb4f4b79821064b51753dbcb`（同一份 67.2 分鐘音訊，經正式佇列）：

| 項目 | 結果 |
|---|---|
| 排隊→逐字稿 | 113.4 秒（MAI 20.8 秒、diarization 90.4 秒） |
| 全程含摘要 | 202.1 秒 |
| 產出 | schemaVersion 3、853 段、8 標籤、853/853 `local-diarization`、853/853 provider 時間戳 |
| 費用 | US$0.4391，3 次 MAI request 全部 HTTP 200，diarization 不增加任何 provider request |

### 10.2 但盲測判定「比舊版差」

12 段逐字稿、同樣的字、只有說話者標籤不同、A/B 隨機對調、判定者看不到來源，
每段 3 個不同視角共 36 票：

| 對照 | 票數 | 段落多數決 |
|---|---|---|
| MAI 舊標籤 vs 整檔 pyannote | **29 : 6** | **10 : 2** |

原因單一且可量化：pyannote 的 `exclusive_speaker_diarization` 會把**重疊的短應答**
併給當下的主要說話者。實際統計 853 段：

| 指標 | 整檔 pyannote 取代 | 混合指派 |
|---|---:|---:|
| 與 provider 逐句「是否同一人」判斷不一致的相鄰配對 | **278 / 852（32.6%）** | **2 / 852（0.2%）** |
| 被吃掉、併給前一位講者的短應答（< 1.5 秒） | **162** | **2** |
| 最終標籤數 | 8 | **6** |

典型錯誤（230–238 秒）：`好。`／`是。` 是聽的人在應答，MAI 標成 Speaker 2，
整檔 pyannote 全部改成正在講話的 Speaker 1。

### 10.3 改法：兩邊各做自己擅長的事

- **句子歸屬**（哪一句屬於哪個標籤）→ 交給 provider。它逐句判斷，聽得到 0.5 秒的插話。
- **身分合併**（哪些 provider 標籤其實是同一個人）→ 交給整檔 pyannote。
  每段依時長投票給重疊最久的 diarization turn，同一個 provider 標籤的所有段落
  取該標籤的加權多數。沒有 provider 標籤的段落（例如 whisper 路徑）維持逐段指派。

實測映射（`job_6d67`）：

```
MAI Speaker 1 → 1        MAI Speaker 2 →2   MAI Speaker 4 →2   MAI Speaker 8 →2   MAI Speaker 9 →2
MAI Speaker 3 → 3        MAI Speaker 5 →4   MAI Speaker 6 →5   MAI Speaker 10→6
```

MAI 的 Speaker 2／4／8 正是接縫拆散的同一個人——獨立聲紋模型（3D-Speaker
ERes2Net，非 pyannote）量到三者互相餘弦相似度 **0.9316–0.9652**，而不同人之間
的基準 ≤ 0.39，合併有硬證據。9 → 6 個標籤，且逐句歸屬幾乎不動（0.2%）。

### 10.4 驗證同時抓到並修掉的缺陷

| 嚴重度 | 問題 | 修法 |
|---|---|---|
| 高 | `assign_speaker_turns`／`_apply_speaker_labels` 在 `try` 之外，出錯會讓工作卡住（不是乾淨失敗） | 移進同一個 `try`；重新指派先建好新 list 才綁定，失敗即保留 provider 結果 |
| 高 | worker 常駐佔用 **2,240 MiB** GPU（快取的 pipeline + allocator），把同卡的 Whisper 備援餓死 | 每份錄音結束呼叫 `torch.cuda.empty_cache()` |
| 中 | CUDA OOM 退回 CPU 後**永久**留在 CPU，且完全沒有 log | 印出訊息（`flush=True`）並丟棄 pipeline，下一份錄音重新嘗試 GPU；Dockerfile 加 `PYTHONUNBUFFERED=1` |
| 中 | 起訖時間完全相同的兩段，顯示編號會隨輸入順序翻轉 | `_apply_speaker_labels` 排序鍵補上 `speaker_index` |
| 低 | 最近鄰回退在距離與起點同時平手時沒有規則 | 排序鍵補上 `end_ms` 與 `speaker` |

已查證但**不修**：torch 2.11+cu128 會把 Dockerfile 原本釘的
`nvidia-cublas-cu12` 12.9.2.10→12.8.4.1、`nvidia-cudnn-cu12` 9.24.0.43→9.19.0.56。
兩者仍含 sm_120 kernel，且重新釘回會改成破壞 torch。實測 Whisper GPU 載入失敗在
新舊 image **完全相同**（`CUDA failed with error out of memory`），肇因是主機上
`llama-server` 佔滿兩張卡（GPU0/1 各只剩 352／457 MiB），與本次改動無關。
Dockerfile 已加註說明。

### 10.5 混合版的盲測與部署（2026-09-10）

同樣的盲測設計，改比「已部署的整檔取代版」與「混合版」，10 段各 3 個視角：

| 對照 | 票數 | 段落多數決 |
|---|---|---|
| 混合版 vs 整檔取代版 | **23 : 7** | **8 : 2** |

部署與驗證：

| 項目 | 結果 |
|---|---|
| 測試 | worker 148 個通過（3 個既有失敗與本次無關：codex summarizer ×2、compose 需 docker） |
| 部署 | `scripts/deploy.sh build transcription-worker` 後 `up --no-build transcription-worker`；部署時無進行中工作；control-plane 未動 |
| 目標 job | `job_6d6744ff…` 換成混合版標籤：**6 個標籤**（原 MAI 9 個、整檔版 8 個），逐句歸屬回到 provider 的判斷 |
| 線上煙霧測試 | `job_ff6794b82a0c44e3814d23dda183b97a`（4 分鐘片段）：54 段全部 `local-diarization`、**3 個標籤**（整檔版對同一片段給出 7 個，含 3 個 <3 秒的碎片標籤） |
| GPU 佔用 | 工作結束後 worker 常駐從 **2,240 MiB 降到 532 MiB** |
| 匯出抽查 | 230–238 秒的 `好。`／`是。` 已正確歸給 Speaker 2 |

### 10.6 嘗試自動拆開 provider 標籤，實測後收回（2026-09-10）

operator 指出 `job_6d67` 的 00:21 與 00:38 兩句聽起來明顯是不同人，但都標成同一位。
查證屬實：MAI 在**同一個切片內**就把兩人併成 Speaker 2，而 pyannote 其實有分開
（7 號與 4 號）。§10.3 的多數決規則會把整個 provider 標籤壓成同一人，因此丟掉了這個資訊。

實作了「有把握就可以拆」的規則：phrase ≥ 2 秒且被單一 turn 覆蓋 ≥ 50% 時採用自己的
投票，其餘短句跟著同一 provider 標籤最近的有把握句。掃過 24 組門檻，只有 2 s / 50%
同時滿足三個已知事實（拆開 operator 指出的兩句、保住聲紋證實的合併、短應答只多吃 2 句）。

**但盲測否決了它**。8 段、每段 3 個視角、共 24 票：

| 對照 | 票數 | 段落多數決 |
|---|---|---|
| 只合併 vs 合併＋拆開 | **18 : 6（只合併勝）** | **6 : 2** |

逐句檢查 127 個被拆走的 phrase 後看到原因——它會把**問句與答句對調**：

```
[2757.1] MAI=Speaker 1（主持人問「俊俊，你有什麼要講」）→ 拆開版 = Speaker 7
[2760.4] MAI=Speaker 6（Benson 回答「沒有，就是剛才叫我幹嘛？」）→ 拆開版 = Speaker 1
```

2751–2843 秒之間這種身分震盪反覆出現：同一個人的連續發言在兩個標籤之間跳動。
成因是 pyannote 的逐句歸屬在重疊處本來就不穩，而拆開規則把這種雜訊放大成錯誤。
試過用「連續段落數／持續時間」過濾雜訊，但 operator 指出的正確拆分本身也只有
3 個連續 phrase／11.5 秒，與雜訊同型，無法區分。

**結論：維持只合併不拆。** 一個 provider 標籤內混兩人，交給既有的逐段改派 UI 處理。
程式碼與測試已回復，`job_6d67` 的 artifact 也已還原（6 個標籤，operator 命名保留）。

另外記錄：本輪的盲測片段挑選有瑕疵——用「相鄰兩句是否同一人」的變化量挑窗，
會漏掉 operator 指出的那種「與六句之前的關係改變」案例。下次應改用標籤身分本身比對。

### 10.7 改用聲紋拆分 provider 標籤（2026-09-10）

§10.6 收回自動拆分後，先做了一輪 40 個 agent 的網路／GitHub 研究，結論是沒有現成
可直接套用的技術（whisperX 的逐句 argmax 就是 §10.2 已失敗的做法；whisper-diarization
的標點對齊與 §10.6 同型；DOVER-Lap 相依 `spy-der` C++ 擴充，實測照文件呼叫回傳 0 筆；
NeMo Sortformer 會與現有 pyannote 相依衝突且上限 4 人）。可行的方向只有一個：
**換一個與時間覆蓋率正交的訊號——聲紋**。

#### 校準（pyannote 自帶的 embedding，不需額外模型或 token）

`Pipeline` 的 `embedding` 設定指向 community-1 repo 的 `embedding` 子資料夾，
可用 `PretrainedSpeakerEmbedding({"checkpoint": <model>, "subfolder": "embedding"})`
直接建立，256 維、CPU 上 440 句 16 秒。

| 比對 | 餘弦相似度 |
|---|---:|
| operator 指出的 00:21 vs 00:38 | **0.224**（不同人 ✓） |
| 00:38 vs 45 秒 / 53 秒 | 0.617 / 0.672（同一人 ✓） |
| MAI Speaker 2 / 4 / 8 質心互比 | **0.938–0.963**（同一人，合併正確 ✓） |
| MAI Speaker 6 標籤內平均 | **0.329**（明顯混兩人 ✓） |
| 其他標籤內平均 | 0.61–0.72 |

#### 規則

在多數決之前，對每個 provider 標籤內「夠長可信」的句子（≥ 1.5 秒）抽聲紋，
以 average linkage、cosine distance threshold **0.70** 分群；只有當至少兩個群
各自 **≥ 3 句且 ≥ 10 秒**時才拆開該標籤，其餘小群併入該標籤最大的群。
太短無法抽聲紋的句子跟著同一標籤時間上最近的已抽聲紋句子。

門檻 0.65–0.80 對三個已知事實（拆開 00:21/00:38、拆開 Speaker 6、不動 Speaker 1）
結果相同，是穩定平台而非刀鋒。最小的正確拆分為 3 句／11 秒，因此下限訂在 3 句／10 秒。

#### 結果（同一場 67.2 分鐘會議，正式程式路徑）

| 指標 | 只合併（§10.3） | 聲紋拆分 |
|---|---:|---:|
| 與 MAI 逐句判斷不一致的相鄰配對 | 2 / 852 | **2 / 852** |
| 被吃掉的短應答 | 2 | **2** |
| 最終標籤數 | 6 | **7** |
| operator 指出的 00:21 vs 00:38 | 同一人（錯） | **分開** ✓ |
| 額外耗時 | — | **+22 秒**（解碼＋440 句聲紋，CPU） |

關鍵在於：兩個防呆指標**完全沒有退步**。§10.6 失敗的原因是判斷訊號與被判斷的
投票同軸；聲紋是不同的物理量，所以能在不動逐句歸屬的前提下修正身分。

全片只有 4 個 22 句視窗的標籤關係改變（以視窗內全部配對計算，不是只看相鄰——
§10.6 用相鄰配對挑盲測片段，正好漏掉 operator 指出的那種非相鄰關係變化）。

#### 盲測結果：8 : 4 反對，但與前兩次的性質不同

4 個有差異的視窗、各 3 個視角、共 12 票：

| 視窗 | 聲紋拆分 : 只合併 | 內容 |
|---|---|---|
| 00:38 | 0 : 3 | 判定者主張 00:38 的人（Coco 稱之為 Danny）與 01:18 之後主持議程的人是同一個，理由是「那個」口頭禪與玩笑連貫 |
| 45:21 | **3 : 0** | 拆分正確：主持人點名「俊俊，你有什麼要講」後，回答者被正確分成另一個人 |
| 46:44 | 0 : 3 | 「你確定你晚上十點想上線？／我說 Coco」被拆成第三人，判定者認為應與前後同一人 |
| 48:27 | 1 : 2 | 墨西哥費用的爭論被拆成兩人 |

前兩次盲測否決（29:6、18:6）的理由是**結構性錯誤**——短應答被吃掉、問句與答句對調，
這些純文字就能證實。本次的反對意見全部是**身分連續性**判斷，而純文字無法確認聲音同一性；
判定者自己也標註「without audio this is not fully certain」。反例：48:27 那段判定者說是
「一個人連續反駁」，但 `那你墨西哥的那個錢到底真的有` 後面接 `有啊，他今天晚上才開會啊`
明顯是一問一答的兩個人，聲紋拆分把它分開是對的。

因此本次採用 operator 的耳朵與聲紋證據為準，維持上線，並把爭議點列為待 operator 確認：
**01:18 起主持議程的人，是 00:38 的 Danny，還是 00:21 的 jun？** 若答案是 Danny，
表示拆分邊界早了一段，jun 的標籤仍多含了 Danny 的後半段發言。

### 10.8 仍未解決

- 同一個 provider 標籤在切片內就把兩個人併在一起時，混合指派無法拆開（provider 說了算）。
- 沒有把 operator 的「大約幾個人」接到 pyannote 的 `min/max_speakers`。
- `KeyboardInterrupt`／`SystemExit` 不被 `except Exception` 攔截，會讓 worker 行程結束
  （交給 compose 的 restart 政策）；這是 Python 的正常語意，刻意不改。
- 原始 provider 標籤在覆寫後沒有保留欄位可供事後比對。

## 十一、聲紋模型換成 WeSpeaker（CNCeleb）＋發聲閘門（2026-09-10）

### 動機：operator 裁定的一句話，pyannote 聲紋每種算法都判錯

`job_abe27`（80.8 分鐘，英/Singlish/華語混雜）00:57「Okay. Okay.」operator 裁定為
Josh。四個模型在同一句上的實測（對兩位候選人的質心餘弦）：

| 模型 | 訓練語料 | 判定 | 備註 |
|---|---|---|---|
| pyannote community-1 embedding（原用） | VoxCeleb（英） | **錯**，且 top-k／AS-norm／拆字全部仍錯 | 差距 −0.203 |
| CAM++ | 中英 | 平手（−0.002） | |
| ERes2Net-large | 中文 | 對（+0.128） | |
| **WeSpeaker ResNet34** | **CNCeleb（中）** | **對（+0.189）**，與自身有把握差距（+0.188）同級；AS-norm +4.90 | 採用 |

同時量到該句 3.16 秒裡只有 **0.57 秒真的有人聲**（兩段爆發夾 2.55 秒 −71 dBFS 靜音，
無重疊：overlap 機率 0.004），是切片邊界把停頓框進來。

### 改動

1. 拆分用聲紋換成 `wespeaker_zh_cnceleb_resnet34_LM.onnx`（Apache-2.0，26 MB，
   sherpa-onnx 於 CPU 執行，每句 ~70 ms），烘進 image `/models/speaker-embedding.onnx`；
   檔案不存在時退回 pyannote 內建並印出訊息。`DIARIZATION_EMBEDDING_MODEL` 可覆寫。
2. **發聲閘門**：句子須含 ≥1 秒實際人聲（20 ms 音框，門檻為整檔第 95 百分位音量
   −35 dB）才能參與拆分投票；不足者跟隨同標籤最近的可信句。
3. 分群門檻跟著模型走：WeSpeaker **0.45**（基準會議平台 0.35–0.55 全數通過三個已知
   事實），pyannote 備援維持 0.70（平台 0.65–0.80）。

### 基準會議驗證（job_6d67，正式程式路徑）

| 指標 | 只合併 | pyannote 聲紋拆分 | **WeSpeaker 拆分** |
|---|---:|---:|---:|
| 與 MAI 逐句不一致 | 2/852 | 2/852 | **2/852** |
| 短應答被吃掉 | 2 | 2 | **2** |
| 00:21 vs 00:38 | 錯 | 對 | **對** |
| 標籤數 | 6 | 7 | **6**（拆出的群併回正確身分） |

80 分鐘會議健檢：10 個標籤僅 2 個被拆、各拆出一個 8 段小群，無爆炸。

### 逐句稽核（比對第二階段的雛形）

以 operator 命名後的標籤建質心，逐句比對：241 句中僅 **6 句**聲音與標籤明顯不合，
其中 4 句同指一事——**Speaker 3 與 Speaker 1（Boon Sing）質心相似度 0.927，是同一人**
（operator 口頭證實）。已以命名合併＋逐段改派套用 operator 裁定
（00:54／00:57 → Josh）。剩兩句待人耳確認：49:27（聲音說 Pang）、75:21（聲音說 Boon Sing）。

### 明確不做：全自動質心合併

80 分鐘會議的質心矩陣整片過熱（不同標籤間 0.62–0.93；S4-S5 高達 0.910 但無人證實），
共享會議聲道的壓縮讓遠端聲音彼此靠近，門檻式自動合併會連環誤殺。正確形式是把
高相似度做成 **UI 建議**（「這兩個標籤聲音非常相似，可能是同一人」）交 operator 一鍵確認；
67 分鐘會議（實體收音）同一模型矩陣乾淨（不同人 ≤0.74），證明過熱是通道問題不是模型問題。

## 參考來源

- [MAI-Transcribe — Microsoft Learn](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-transcribe)
- [Use the fast transcription API — Microsoft Learn](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/fast-transcription-create)
- [Diarization add-on pricing — Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/5634306/how-much-is-the-pricing-of-using-the-diarization-a)
- [Azure Speech pricing](https://azure.microsoft.com/en-us/pricing/details/speech/)
- [MAI-Transcribe-2 announcement — Microsoft Community Hub](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/mai-transcribe-2-highest-quality-transcription-at-the-fastest-speed-and-lowest-c/4550972)
- [MAI-Transcribe-2 pricing/positioning — VentureBeat](https://venturebeat.com/infrastructure/microsoft-ais-mai-transcribe-2-undercuts-openai-google-and-elevenlabs-on-price-and-speed)
- [pyannote community-1](https://www.pyannote.ai/blog/community-1)
- [pyannote vs NVIDIA NeMo Sortformer](https://www.pyannote.ai/blog/pyannote-vs.-nvidia-nemo-diarization-accuracy-setup-and-production-readiness)
- 專案內部：`openspec/changes/improve-uploaded-meeting-note-quality/benchmark.md`、
  `openspec/changes/use-mai-luna-transcription-pipeline/design.md`、
  `HANDOFF.md`、`docs/research/2026-07-29-qwen-vs-stored-azure.md`
