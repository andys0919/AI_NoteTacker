# 中文會議 ASR 領域術語通用解法研究

> **2026-07-29 完整影片更正：** 原始畫面明列 `Tray盤`與
> `Input Tray Setting`，所以本文件把 `舌片／蛇片`視為正確候選的歷史例子
> 不能再當 ground truth。完整 A/B 見
> [HDD 會議完整 ASR 與通用修正流程驗證](2026-07-29-full-asr-validation.md)。
> 下述 content gate、不可偷看答案、保留 raw evidence 及需要可信 context 的
> 架構結論仍成立；實際錯誤分類應改為跨語言／近音 lexical substitution，
> 直到人工 reference 裁決。
>
> 調查日期：2026-07-29
> 範圍：只使用官方 API／模型文件、官方 GitHub／model card 與原始論文。
> 邊界：PLAUD 逐字稿、HDD 人工答案與事後聽到的正字只可作最後評分，
> 不得成為 prompt、phrase list、hotword、訓練資料或模型選擇後的調參依據。

## 結論

`蛇片`、`舌片`是模型輸出的兩個中文候選，不是已證實的正字；原始影片另提供
`Tray盤`這個正式詞彙。這種跨語言／近音 lexical substitution 不是音訊增強
或 diarization 可以穩定解決的問題。就兩個中文候選本身而言，
教育部辭典列出的 `舌`、`蛇`都是 `shé`；在後一字同為 `片` 時，兩個候選
具有相同的標準國語讀音。[舌](https://dict.revised.moe.edu.tw/dictView.jsp?ID=8843&la=0&powerMode=0)、
[蛇](https://dict.revised.moe.edu.tw/dictView.jsp?ID=8847&la=1&powerMode=0)。
同理，`條`與`調`在相關讀音都是 `tiáo`，所以 `條碼／調碼`也可能只有文字
語境能區分。[條](https://dict.revised.moe.edu.tw/dictView.jsp?ID=2695&la=0&powerMode=0)、
[調](https://dict.revised.moe.edu.tw/dictView.jsp?ID=2698&q=1&word=%E8%AA%BF)。

因此，這個失敗類型的根因是：

1. 聲學訊號只足以支持相同或近似的音節；
2. ASR decoder 必須用訓練時學到的語言先驗、前後文和外部詞彙 context，
   決定輸出哪個文字；
3. 正確的企業術語若不在模型先驗或錄音前 context 裡，模型只能選擇它認為
   posterior 較高的另一個同音候選。

但最新的本機 artifact 診斷也證明，先前的 `蛇片 88／舌片 1`不能全部歸因於
同音字。完整長音訊另有兩段嚴重 repetition／hallucination failure loop，
其中尾段重複 60 次`蛇片上面的條碼要怎麼弄?`。排除該尾段 loop 後，只剩
`蛇片 27／舌片 1`。因此目前其實有兩個獨立問題：

1. **長音訊解碼 failure loop**：不真實的重複文字灌大 character、term count
   和 coverage 類指標；
2. **有效語音內的 lexical 消歧**：即使移除 failure loop，`Tray／舌／蛇`
   等跨語言或近音候選仍需合法 context 或人工確認。

修復順序必須先攔截 failure loop、重跑 transcript，再評估真正的術語錯誤。

Microsoft 將 acoustic model 定義為從聲音估計語音單位，language model 則為
詞序列指定機率；Azure Speech 也明確說通用語言模型反映常用口語，領域詞彙
要以文字或客製資料補強。
[Microsoft acoustic modeling](https://www.microsoft.com/en-us/research/project/acoustic-modeling/)、
[Microsoft language modeling](https://www.microsoft.com/en-us/research/project/language-modeling-for-speech-recognition/)、
[Azure Custom Speech overview](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/custom-speech-overview)。

最重要的通用邊界是：

- **錄音前已知詞彙**：可以合法地用組織詞庫、議程、產品清單、客戶資料和
  既有文件做 contextual biasing；這不是偷看答案。
- **錄音前完全未知的新術語**：若聲音與另一文字完全同音，沒有任何 ASR
  可以從音訊本身保證選到正字。通用解法是保留候選、標示不確定、讓人確認，
  確認後才從下一個 vocabulary version 開始學習。

沒有可信的「第一遍就自動修正所有首次出現同音術語」演算法。硬選一個正字只會
把可見的 ASR 錯誤變成不可見的自動竄改。

## 1. 這次數量差異能證明什麼

目前 HDD 比較中，Azure 多次輸出 `蛇片`、PLAUD 多次輸出 `舌片`，只能證明
兩套系統在同一音訊上選擇了不同文字假設；PLAUD 不是 ground truth，次數本身
不能證明 PLAUD 每一處都正確，也不能反推出 PLAUD 的模型或私有詞庫。

可以確定的失敗分類是 lexical substitution；沒有人工 reference 前，不能再
縮窄成「正字必然是舌片」的同音字 substitution。Microsoft 對 ASR 誤差的官方
說明把 substitution 與領域詞彙不足連在一起，並建議以人工作為 reference
量測，而不是拿另一家 ASR 當答案。
[Azure Speech accuracy evaluation](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-custom-speech-evaluate-data)。

### 1.1 新發現：完整 Azure raw transcript 有 repetition failure loop

本機對正確 WAV hybrid raw artifact 的重新檢查找到：

| 時間範圍 | 重複內容 |
|---|---:|
| 11.753–299.881 秒 | 6 次`好,那我先再錄製。`、6 次`好,那我先錄製。`、465 次`我先錄製。` |
| 5474.346–5609.520 秒 | 60 次`蛇片上面的條碼要怎麼弄?` |

因此先前 overall `蛇片 88／舌片 1`的 88 次裡，60 次來自同一個尾段 failure
loop；排除後是`蛇片 27／舌片 1`。這仍顯示同音正字問題，但嚴重度不能再用
88:1 表示。

PLAUD exact JSON 的 post-hoc count 也應更正為：

- `舌片` 32；
- `色片` 3；
- `射片` 2；
- `首片` 1；
- `蛇片` 1。

這再次證明 PLAUD 只能是 comparison candidate，不是逐字 ground truth；
上述 PLAUD 文字不得進入任何 prompt、hotword 或修復 retry。

OpenAI 官方 Whisper 的長音訊 decoder 本身就使用
`compression_ratio_threshold`、`logprob_threshold`與
`no_speech_threshold`判定失敗或靜音；同一份官方程式說明，將
`condition_on_previous_text`設為 false 雖可能降低跨 window 一致性，但較不會
陷入 repetition loop 或 timestamp 失同步。
[OpenAI Whisper `transcribe.py`](https://github.com/openai/whisper/blob/main/whisper/transcribe.py)。

WhisperX 原始論文也指出，長音訊的 buffered／sliding-window 解碼容易 drift、
hallucination 和 repetition，並顯示 VAD Cut & Merge 預先切出 speech segments
能改善長音訊轉錄品質。
[WhisperX paper](https://arxiv.org/abs/2303.00747)。

這些來源不是說 Azure `gpt-4o-transcribe`內部就是 Whisper；它們支持的是
**content-agnostic 長音訊防護模式**：偵測可疑重複、切回短 speech-only audio、
移除 previous-output context 重試，而不是根據正確答案修字。

### 1.2 Content-agnostic repetition gate

gate 不需要知道`舌片`或任何領域詞。每個 provider chunk 完成後只看：

- UTF-8 文字的 gzip compression ratio，極端可壓縮通常代表大量重複；
- normalized sentence／n-gram 是否在短時間窗重複並占據大部分輸出；
- provider 有提供時的 average logprob、token confidence、no-speech probability；
- 本機 VAD 的 speech duration 是否與輸出長度／重複密度明顯不相稱；
- timestamp 是否停滯、逆行或長時間由同一句佔滿。

OpenAI Whisper 的 threshold 數值是針對 Whisper decoder 的預設，不能直接複製
成 Azure、Qwen 或 FunASR 的通用常數。各 provider 要在 blind development set
校準，但 detection feature 本身不含任何 target phrase。

觸發 gate 後的最小恢復流程：

1. 保存原始 response 和可疑 span，不刪除；
2. 用 VAD 將原 audio span 切成更短的 speech-only chunks；
3. retry 時移除 previous-output prompt／context，避免把 loop 再餵回 decoder；
4. 使用相同語言政策與錄音前 vocabulary snapshot，不加入從失敗輸出學到的詞；
5. 若 retry 通過 gate，保存 replacement 並保留與原始 response 的 lineage；
6. 若仍失敗，保留 raw evidence、標記人工 review，不假造乾淨 transcript。

**不能盲目文字去重。** 真實會議可能真的重複句子，文字去重會刪掉有時間意義的
發言，也無法補回 loop 遮蔽的原音。gate 只能授權「從原 audio 重新辨識」或
「人工確認」，不能授權直接刪字。

### 1.3 既有 aggregate benchmark 必須重算

[`benchmark.md`](../../openspec/changes/improve-uploaded-meeting-note-quality/benchmark.md)
裡所有由該 raw transcript 派生的 aggregate，在 failure-loop recovery 完成前
都不是最終數字，至少包含：

- raw／display character count；
- transcript segment count；
- 與 PLAUD 的 coverage proxy 與 sequence similarity；
- `蛇片／舌片／條碼`等 term count；
- summary input、逐字稿引用與可能受重複內容影響的摘要；
- speaker attributed-character coverage 與任何會受異常文字對齊影響的比例。

既有 benchmark 仍保留作診斷歷史，但不能再用`蛇片 88／舌片 1`代表 88 個
獨立的同音辨識錯誤。

### 1.4 目前程式還有一個可能的放大器

現有 worker 每五分鐘切 chunk，並把前面逐字稿最後 800 個字放進下一個 chunk
的 prompt；相關程式在
[`transcription_context.py`](../../workers/transcription-worker/src/transcription_worker/transcription_context.py)
與
[`azure_openai_transcriber.py`](../../workers/transcription-worker/src/transcription_worker/azure_openai_transcriber.py)。

這對跨 chunk 句子連續性有幫助，但也可能形成錯字 feedback loop：

```text
第一個 chunk 選成「蛇片」
        ↓
錯字進入下一個 chunk 的 previous transcript context
        ↓
後續相同發音更容易延續「蛇片」
```

這是有程式路徑支持的**待驗證假說**，不是已證明的主因。必須在另一組 blind
development audio 上比較：

1. 不傳前文；
2. 傳完整前文尾巴；
3. 只傳不含低信心／爭議術語的前文尾巴。

HDD 已經揭露了目標錯字，不能再拿它選這三個設定；它只能保留為 regression
case。

### 1.5 本機單變因重播：只能作 diagnostic，不是 production 選型

同一正確 WAV、同一 Azure deployment、沒有 PLAUD／人工詞彙的重播結果：

| 音訊範圍與設定 | 結果 |
|---|---|
| 300–420 秒，generic prompt | `蛇片` 3、`舌片` 0；`MES`相對正常 |
| 300–420 秒，同一 prompt 加前段模型自身、已通過 repetition gate 的 800 字尾文 | `蛇片` 0、`舌片` 4；但多處`MES`被擾成`MVAS` |
| 0–300 秒，generic prompt 重播 | HTTP 200、9.65 秒完成，沒有`錄製`loop，`舌片` 3 |

這支持兩個診斷：先前的`錄製`loop 是可重播後消失的 transient decoder
failure；previous-output context 確實能翻轉完全同音的正字，但也會傳播或
引入新的縮寫錯誤。它**不證明**尾文設定較好，更不能因為這次剛好得到`舌片`
就選為 production 設定。HDD 的答案已揭露，三個結果只能保留為 regression
證據；前文策略必須在全新 blind development set 上同時計算 CER、術語正確率
與 false insertion／corruption 後再決定。

所以 production 的 previous context 只能是 soft context，且必須先通過
repetition、confidence／disagreement 和縮寫／entity 完整性 gate；不得把
前段文字當成硬式修正規則。

## 2. Acoustic、language/context 與 display correction 必須分開

```text
原始音訊
   │
   ├─ 聲學品質：音量、噪音、重疊說話、距離、壓縮
   │
   ▼
Acoustic encoder / speech representation
   │
   ├─ 可能音節或 token 候選
   ▼
Decoder + language/context prior
   │
   ├─ 語言提示
   ├─ 錄音前詞彙／議程／產品資料
   ├─ N-best / lattice / LM rescoring
   ▼
Provider raw transcript
   │
   ├─ confidence／disagreement → review
   └─ 有獨立可信證據才做 display correction
```

### 2.1 Acoustic 問題

弱訊號通常造成 deletion，噪音和 crosstalk 可能造成 insertion，背景噪音、
麥克風品質、重疊說話也會增加錯誤。
[Azure Speech accuracy evaluation](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-custom-speech-evaluate-data)。

對這類錯誤，改善收音、VAD、channel selection、音量與條件式降噪有意義。
但 speech enhancement 不是無條件更好；原始研究顯示 enhancement 產生的
artifact 本身可能讓 ASR 變差。
[How Bad Are Artifacts?](https://arxiv.org/abs/2201.06685)。

因此要保存原始 WAV，先做音訊品質 gate，再用同一人工 reference 比較
original 與 enhanced 版本。不能只因為聲音聽起來更乾淨就採用。

### 2.2 Language/context 問題

完全同音字沒有可額外增強的子音或聲調差異。`舌／蛇`和`條／調`的正字只能
靠語境、既有詞彙或人工確認。Azure phrase list 官方也把 homonyms、組織專用
詞與縮寫列為主要用途，並說加入詞彙是提高其相對重要性，不是增加新的聲音證據。
[Azure phrase list](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/improve-accuracy-phrase-list)。

`Movie in／move in`則是中英 code-switch 下的近似發音與語境問題，不應以固定
字串替換。要先保留原文候選，再利用錄音前已知的流程用語或人工確認。

### 2.3 Display correction 問題

摘要 LLM 或文字後處理可以把已知公司名稱拼回正確格式，但它看不到原始聲學
證據。OpenAI 官方的 post-processing 範例也要求先提供正確產品拼法，並提醒
要對照原音避免改掉說話內容。
[OpenAI improving reliability](https://developers.openai.com/api/docs/guides/speech-to-text#improving-reliability)。

因此：

- `rawText` 必須保留 provider 原始輸出；
- `displayText` 只有在錄音前既有詞彙、明確人工接受或其他獨立證據支持時才改；
- 不得用 target transcript 推導 `蛇片 → 舌片` 之類 alias，再把結果稱為
  unassisted accuracy。

## 3. 已知詞彙與未知術語的不同處理

| 類型 | 定義 | 可以自動做什麼 | 不可以做什麼 |
|---|---|---|---|
| 已知組織詞彙 | 在錄音開始前已存在於產品、客戶、專案、議程或人工接受詞庫 | language hint、prompt、keywords、phrase list、hotword、LM rescoring、正字 display mapping | 從本次 ASR／PLAUD／人工答案新增候選 |
| 已知拼法、未知發音 | 詞已存在，但縮寫、口音或特殊讀法不清楚 | pronunciation lexicon；累積跨錄音的人工標註音訊 | 用錯聽結果猜一個發音後直接覆蓋 |
| 首次出現未知詞 | 錄音前所有合法 context 都沒有 | 產生 N-best／候選、標記 uncertainty、請人確認 | 宣稱音訊可唯一決定完全同音的正字 |
| 聲學受損內容 | 噪音、低音量、重疊、遠場造成漏字或混字 | 原始／增強音訊 A/B、speaker-aware ASR、改善收音 | 把聲學問題一律當 glossary 問題 |

Microsoft Custom Speech 支援 plain text、structured text、發音資料，以及
audio + human-labeled transcript；官方建議先從相關文字開始，只有口音、
說話方式或背景噪音問題才需要音訊標註。
[Azure Custom Speech datasets](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-custom-speech-test-and-train)。

這正好提供最小升級順序：

1. 錄音前 context／詞彙偏置；
2. N-best 或 disagreement review；
3. 累積足夠乾淨標註後才 fine-tune；
4. acoustic domain 確實不同時才加入音訊訓練。

## 4. 通用解法元件

### 4.1 Pre-existing organization vocabulary

建立帳號／組織詞彙庫，每個 entry 至少保存：

- canonical spelling；
- language／locale；
- entity type，例如 product、customer、person、acronym；
- 來源文件、來源版本、`effective_at`；
- 可選 pronunciation；
- 人工接受者與時間；
- 停用時間。

每個 transcription job 只保存一份 immutable vocabulary snapshot。是否符合
oracle-free 的判斷很簡單：

```text
entry.effective_at < recording.started_at
```

且來源不能是本次錄音、PLAUD、ASR 結果或本次人工 reference。

### 4.2 Pre-meeting document retrieval

完整組織詞庫可能很大，不能全部塞進每次解碼。應在錄音前依已知 metadata
取小而相關的 subset：

- 客戶／專案；
- 會議議程；
- 參與者；
- 產品與料號；
- 最近已核准的專案文件。

OpenAI 官方提醒 keywords 只能放相關詞，並要評估是否造成「未說出口的詞」
被插入；Azure phrase list 也建議控制在 500 phrases 內。
[OpenAI transcription context](https://developers.openai.com/api/docs/guides/speech-to-text#add-transcription-context)、
[Azure phrase list](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/improve-accuracy-phrase-list)。

FunASR 團隊的 H-PRM 原始論文也指出，大型 hotword list 會使辨識率下降，
因此先取回小型候選集合再 bias 是合理方向。
[H-PRM](https://arxiv.org/abs/2508.18295)。

這個 retrieval 只能縮小錄音前詞庫，不得查詢「這段 ASR 好像是蛇片，正確
可能是什麼」後回填當次 raw transcript。

### 4.3 Contextual biasing／hotwords

Contextual biasing 是調整候選文字的相對分數，不是保證輸出。必須同時測：

- target term recall；
- 未說出 hotword 的 false insertion；
- 一般 CER 是否惡化；
- 同音但語境不符合時是否被過度替換。

Azure phrase list 可即時提高詞彙權重；Azure Custom Speech 可用相關文字、
發音及人工標註資料訓練。
[Azure phrase list](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/improve-accuracy-phrase-list)、
[Azure Custom Speech datasets](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-custom-speech-test-and-train)。

FunASR 的 SeACo-Paraformer 是專門支援 hotword customization 的中文模型；
原始論文與官方 repo 都公開這項能力。
[SeACo-Paraformer paper](https://arxiv.org/abs/2308.03266)、
[FunASR](https://github.com/modelscope/FunASR)。

### 4.4 N-best、lattice、confusion network 與 rescoring

單一 1-best 只保留模型最後選擇，看不到 `舌片／蛇片`是否都在合理候選中。
Kaldi 官方把 lattice 定義為仍具合理機率的替代 word sequences，並支援
N-best、posterior confidence、MBR 與 language-model rescoring。
[Kaldi lattices](https://kaldi-asr.org/doc/lattices.html)、
[Kaldi lattice tools](https://kaldi-asr.org/doc/tools.html)。

通用用法是：

1. ASR 保留 acoustic score 與多個候選；
2. 用錄音前凍結的組織 LM／文件 context rescore；
3. 若候選分數接近或 context 不支持任何一個，送人工 review；
4. 不以另一家 ASR 的 1-best 當自動真理。

NeMo 官方 neural rescoring 是把 beam search 的 top-K 候選交給另一個語言
模型排序；WeNet 2.0 同時提供 n-gram LM、WFST、兩階段 rescoring 與
contextual biasing。
[NeMo neural rescoring](https://docs.nvidia.com/nemo-framework/user-guide/latest/nemotoolkit/asr/asr_customization/neural_rescoring.html)、
[WeNet 2.0](https://arxiv.org/abs/2203.15455)。

若 provider 只回單一文字與 token logprobs，就沒有真正的 N-best/lattice。
用 temperature 多跑幾次只是 stochastic samples，不應偽裝成同一 decoder 的
校準 N-best。

### 4.5 Confidence 與 uncertainty

Confidence 的正確用途是「排 review 優先順序」，不是「低於門檻自動換字」。
OpenAI 的 logprobs 說明把它定義為模型對 transcription token 的信心；
Azure Speech 的 detailed output 可回 `NBest` 和每個 entry 的 confidence。
[OpenAI transcription API](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create)、
[Azure Speech detailed output](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text-short)。

Kaldi 官方甚至特別警告，best 與 second-best cost difference 不一定是好的
confidence measure。[Kaldi lattice tools](https://kaldi-asr.org/doc/tools.html)。

因此 uncertainty gate 應合併：

- token／word confidence；
- N-best posterior margin 或 entropy；
- 兩個獨立模型是否在同一時間 span 不一致；
- 詞彙是否有錄音前可信來源；
- 音訊品質與 overlap；
- 是否屬於高價值 entity。

只有「低 confidence」不能授權改字；「高 confidence」也不保證同音字正確。

### 4.6 Human feedback loop

人工修正不是把答案偷餵回同一個 benchmark，而是建立有時間邊界的產品記憶：

1. 使用者聽原音並接受正字；
2. 保存 raw provider evidence、時間 span、原候選和 accepted term；
3. 建立下一版 organization vocabulary；
4. 新版只作用於後續 job；
5. 累積到足夠多、跨講者、跨環境的資料後才作 fine-tuning。

Azure 官方要求用高品質 word-by-word human transcripts，並強調資料要涵蓋
實際使用情境、口音、環境與硬體；測試資料要和訓練資料分開。
[Azure Custom Speech datasets](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-custom-speech-test-and-train)、
[Azure accuracy test](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-custom-speech-evaluate-data)。

### 4.7 Fine-tuning 與 adapters

Fine-tuning 是最後一層，不是第一個修字工具。它適合：

- 有大量、乾淨且經人工確認的領域音訊與逐字稿；
- base model、prompt／hotword 和 rescoring 已不足；
- 可保留未見 meeting 的 chronological holdout；
- 有能力監控一般中文品質是否退化。

Qwen3-ASR 官方 repo 提供 JSONL audio-text pair 的 full fine-tuning 流程，
沒有在該官方腳本中承諾 parameter-efficient adapter。
[Qwen3-ASR fine-tuning](https://github.com/QwenLM/Qwen3-ASR/tree/main/finetuning)。

NeMo 官方同時提供 ASR fine-tuning 與 adapters；adapter 只訓練少量新增參數，
適合大型模型的 domain specialization。
[NeMo ASR fine-tuning](https://docs.nvidia.com/nemo/speech/nightly/asr/fine_tuning.html)、
[NeMo adapters](https://docs.nvidia.com/nemo/speech/nightly/core/adapters/intro.html)。

任何 fine-tune 都不得包含最終 test meeting 或由 PLAUD 產生的 pseudo-label。

### 4.8 Speaker-aware ASR

目前的 `gpt-4o-transcribe-diarize`是 speaker evidence pass，不是術語修正器。
OpenAI 官方 API 明列 diarize model 不支援 prompt 或 logprobs；它的能力是
speaker segments。
[OpenAI Speech-to-Text](https://developers.openai.com/api/docs/guides/speech-to-text#transcriptions)。

真正 speaker-aware／multi-talker ASR 會在辨識過程中用 speaker information
處理重疊語音。NeMo 的 Multitalker Parakeet 以 speaker kernel injection
讓每個模型 instance 聚焦一個 speaker；這能處理 overlap，但官方 checkpoint
目前列為 English，不能直接當成中文 HDD 解法。
[NeMo Multitalker model](https://docs.nvidia.com/nemo/speech/nightly/asr/featured_models.html)、
[NeMo checkpoints](https://docs.nvidia.com/nemo/speech/nightly/asr/asr_checkpoints.html)。

結論：

- speaker diarization 可改善「誰在何時說話」；
- speaker-aware ASR 可能改善重疊說話造成的漏字／混字；
- 兩者都不會憑空知道完全同音的企業正字。

## 5. 候選方案比較

| 候選 | 錄音前 context | N-best／rescoring／confidence | fine-tune | 中文會議定位 |
|---|---|---|---|---|
| OpenAI direct `gpt-transcribe` | 官方文件支援 `prompt`、`keywords`、`languages`；keywords 是 hint，需測未說詞插入 | API 可提供模型信心資訊，但公開 file transcription 契約不是完整 lattice | 未公開 ASR fine-tune | 若可提供 direct OpenAI key，值得作 hosted contextual A/B |
| Azure OpenAI `gpt-4o-transcribe` | `prompt`、單一 `language`；沒有 Azure Speech phrase-list weight | logprobs；單一 transcript，沒有公開 lattice | 無公開 audio fine-tune | 保留 current baseline；prompt 只能算 soft bias |
| Azure OpenAI `gpt-4o-transcribe-diarize` | 不支援 prompt | speaker segments；不支援 logprobs | 無 | 只作 speaker evidence，不作文字 authority |
| Azure Speech | Phrase list、weight、Custom Speech text／pronunciation／audio | detailed `NBest` + confidence；Custom Speech 可固定 model version | 支援 | 若留在 Azure，最完整的已知詞彙通用方案 |
| Qwen3-ASR-1.7B-hf | 官方 model card 現已支援 free-form `prompt`／context hotwords 和 forced language | 官方公開 interface 未提供 lattice／校準 N-best 契約 | 官方 repo 支援 full fine-tune | 零樣本中文與本機 context 第一順位 A/B |
| FunASR SeACo-Paraformer | 中文 hotword customization；可與 VAD、標點、speaker pipeline 組合 | toolkit 依模型不同；不應假設每個 checkpoint 都有 N-best | toolkit 支援模型訓練 | 已知中文術語 hotword 第一順位 A/B |
| WeNet | context bias、n-gram LM、WFST | 兩階段 decoder、N-best／LM rescoring | 支援訓練 | 需要透明 lattice/rescoring 時的研究候選 |
| NVIDIA NeMo | phrase boosting、prompted model、LM fusion | N-best、neural rescoring、frame/token/word confidence | full fine-tune + adapters | 客製能力最完整，但中文 checkpoint 與部署成本需另外驗證 |

來源：

- OpenAI 目前官方 Speech-to-Text guide 說 `gpt-transcribe`支援
  `prompt`、`keywords`與`languages`，並提醒 keywords 不是必出文字。
  [OpenAI transcription context](https://developers.openai.com/api/docs/guides/speech-to-text#add-transcription-context)
- Azure OpenAI 公開 Audio API 目前列出的模型仍是 `gpt-4o-transcribe`、
  mini、Whisper 與 diarize，不能假設 direct OpenAI 的 `gpt-transcribe`
  已可部署到現有 Azure endpoint。
  [Azure OpenAI audio reference](https://learn.microsoft.com/en-gb/azure/foundry/openai/reference-preview)
- Qwen 官方 Hugging Face model card 現在明確示範以 `prompt`／system message
  傳 domain vocabulary 與 hotwords；這是 2026-07-29 能核對到的新契約。
  [Qwen3-ASR-1.7B-hf model card](https://huggingface.co/Qwen/Qwen3-ASR-1.7B-hf)
- FunASR 官方 repo 示範 Paraformer `hotword`、VAD、標點與 speaker pipeline。
  [FunASR](https://github.com/modelscope/FunASR)
- WeNet 2.0 原始論文公開 LM、WFST、two-pass rescoring 與 contextual biasing。
  [WeNet 2.0](https://arxiv.org/abs/2203.15455)
- NeMo 官方公開 word boosting、neural rescoring、confidence、fine-tuning 與
  adapters。
  [Word boosting](https://docs.nvidia.com/nemo-framework/user-guide/latest/nemotoolkit/asr/asr_customization/word_boosting.html)、
  [Neural rescoring](https://docs.nvidia.com/nemo-framework/user-guide/latest/nemotoolkit/asr/asr_customization/neural_rescoring.html)、
  [Confidence](https://docs.nvidia.com/nemo/speech/nightly/asr/asr_language_modeling_and_customization.html)。

### 對 AI_NoteTacker 的最短候選順序

1. 保留現有 Azure `gpt-4o-transcribe` 作 baseline。
2. 測 Qwen3-ASR-1.7B-hf：
   - base model，不傳 context；
   - 同一份錄音前 organization vocabulary prompt。
3. 測 FunASR SeACo-Paraformer：
   - base model，不傳 hotword；
   - 同一份 frozen hotword set。
4. 若有 direct OpenAI key，再測目前 `gpt-transcribe`的
   `keywords + languages`。
5. 只有前三者仍無法達標，才投入 WeNet／NeMo 的 lattice、LM、adapter 或
   fine-tuning；不要先建立通用 provider framework。

## 6. Oracle-free 可重現 benchmark

### 6.1 HDD 的正確定位

HDD 錄音的問題詞與 PLAUD 結果已經被看過，因此：

- 它仍可作固定 regression case；
- 它可以比較完全 frozen 的 unassisted base model；
- 它不能再作選 hotword、選 prompt、選權重、選前文策略或選 checkpoint 的
  無偏 test set；
- 在 HDD 上反覆挑出「最接近 PLAUD」的模型，也會形成 benchmark overfitting，
  即使沒有直接傳 phrase list。

要證明通用性，必須另留至少一場從未看過輸出的新會議作 locked holdout。

### 6.2 三個分離的 evaluation track

#### Track A：Unassisted provider quality

所有模型只收到：

- 完全相同的原始音訊；
- 事前固定的語言政策；
- 不含領域正字的通用忠實轉錄 instruction；
- 相同 chunk policy。

不得收到：

- 組織詞庫；
- PLAUD；
- HDD 已知問題詞；
- 人工 reference；
- 從同一 audio 前一次 ASR 產生的 term list。

這個 track 回答「base model 本身有多好」。

#### Track B：Frozen known-vocabulary workflow

所有 provider 收到同一份、錄音前已存在的詞彙 snapshot。不同 API 可以用
各自原生方式：

- OpenAI `keywords`／prompt；
- Azure Speech phrase list；
- Qwen context prompt；
- FunASR hotword；
- WeNet／NeMo context bias。

這個 track 回答「產品在合法事前 context 下有多好」，不能和 Track A 混成
單一 accuracy。

#### Track C：Previously unknown terms

從 reference 中標出 snapshot 不包含的新術語。系統在這個 track 可得分的行為
有兩種：

1. 正確轉錄；
2. 沒把握時準確標成 review candidate。

若完全同音又沒有獨立 context，系統不因「拒絕亂改」而判定產品失敗；應另外
計算 unknown-term exact match 與 uncertainty-review precision。

### 6.3 資料與凍結規則

最小可信 corpus：

- 至少 30 分鐘有代表性的中文會議音訊；Microsoft 的正式 accuracy test
  建議 30 分鐘到 5 小時。
  [Azure accuracy test](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-custom-speech-evaluate-data)
- 多於一場 meeting，涵蓋不同講者、麥克風距離、噪音與中英混用；
- development、validation、locked test 依 meeting／時間切分，不能把同一場
  meeting 的相鄰 chunk 隨機拆到 train 與 test；
- reference annotator 在看不到任何 provider／PLAUD 輸出的情況下逐字標註，
  爭議術語由第二人或領域人員 adjudicate；
- 先鎖定 provider output，再揭露 reference。

每次 run 保存：

- audio SHA-256；
- model ID、model revision／commit SHA；
- runtime container digest；
- decoding parameters、temperature、seed；
- chunk boundaries；
- vocabulary snapshot SHA-256 與 `effective_at`；
- preprocessing command；
- raw provider response；
- elapsed、GPU memory、request count 和成本。

### 6.4 必要指標

| 指標 | 用途 |
|---|---|
| 中文 CER | 全文 substitution／insertion／deletion |
| Known-term precision／recall | 事前詞彙有沒有真正改善 |
| Hotword false insertion rate | bias 是否把未說詞塞進逐字稿 |
| Unknown-term exact match | base model 對首次新詞的能力 |
| Review precision／coverage | uncertainty gate 是否抓到真正錯誤、人工負擔多大 |
| Code-switch entity accuracy | `MVS`、`move in`一類中英混用 |
| Unsupported-text rate | 是否出現音訊沒有的內容 |
| Repetition-loop rate | content-agnostic gate 是否攔到長音訊 failure loop |
| Speaker-attributed CER + DER | 只在有人工作為 speaker ground truth 時量測 |
| Latency／RTF／VRAM／成本 | 能否進 production |

不能用：

- 與 PLAUD 的 sequence similarity 當 accuracy；
- transcript character count 當完整度真相；
- PLAUD speaker label agreement 當 DER；
- 只算 target hotword recall、不算 false insertion。

### 6.5 Ablation matrix

在 development set 上先跑最小矩陣：

| 實驗 | 目的 |
|---|---|
| 原始 WAV vs 標準化 PCM | 分離 codec／audio representation |
| 原始 vs 條件式 enhancement | 證明降噪是否真的降低 CER |
| 五分鐘 chunk vs VAD short chunks | 分離長音訊 drift／repetition |
| auto language vs 合法固定語言／多語 hints | 分離 language routing |
| no previous tail vs raw previous tail vs uncertainty-filtered tail | 檢查錯字 feedback loop |
| no vocabulary vs frozen pre-meeting vocabulary | 量化 contextual bias 淨收益 |
| 真實 frozen terms vs 加入未說出的同領域 distractors | 量化 hotword false insertion |
| 1-best vs N-best／LM rescoring | 量化語境重排，而非換另一個答案 |

選完設定後鎖定配置，只在 untouched holdout 跑一次。Holdout 結果不能再反過來
調 hotword weight 或 prompt。

## 7. 建議的最小產品流程

```text
錄音前文件／專案 metadata
        ↓
有來源與生效時間的 organization vocabulary
        ↓ 只取相關 subset，凍結 snapshot
Primary ASR ───────────────→ immutable provider response
        │
        ├─ repetition／compression／VAD gate
        │      └─ 可疑：短 VAD chunks + 無 previous output retry
        ↓
accepted rawText
        │
        ├─ N-best／confidence／第二模型 disagreement
        ↓
高風險 span review queue
        │
        ├─ 有事前可信詞彙 → evidence-backed displayText
        └─ 沒有可信詞彙 → 保留 raw + 候選，請人確認
                                      ↓
                              下一版 vocabulary
```

最小實作原則：

1. 不改現有 `transcribe(...) -> artifact` seam；
2. 先補一個不含領域詞的 repetition gate 和 bounded audio retry；
3. 再以離線 A/B 選出一個真正勝出的文字模型；
4. 只新增 organization vocabulary snapshot 與 provenance；
5. 只在爭議 span 跑 verifier，避免每個 chunk 永遠雙模型；
6. provider raw evidence 永不覆寫；
7. fine-tuning 等累積到跨 meeting 的乾淨資料再做。

## 8. 最終判定

這次 `蛇片／舌片`失敗不是：

- 摘要模型不夠強；
- diarization 沒打開；
- 400 retry 不足；
- 單純把音訊升頻或降噪就能修好。

現在已確認是兩層問題：完整長音訊有嚴重 repetition failure loop；扣除已知
尾段 loop 的灌水後，仍可見跨語言／近音下的 domain-language-context 缺失，但
真正嚴重度要在所有可疑 span 從原音重跑後才能量化。噪音、code-switch、
chunk context 和前文 feedback 仍可能再放大問題，要用 blind ablation 分開
證明。

通用且不偷看答案的解法是：

1. **先保全文**：用 compression／重複／VAD／confidence gate 偵測 failure
   loop；從原 audio 以短 VAD chunks、無 previous-output context 重試，絕不
   盲目去重。
2. **零樣本能力**：用 untouched audio 比較 Azure、Qwen3-ASR、FunASR，
   有 direct OpenAI key 時加入 `gpt-transcribe`。
3. **合法 context**：只用錄音前存在、有來源與時間戳的 organization
   vocabulary，分開報告 assisted 成績。
4. **多假設**：能拿 lattice／N-best 就 rescore；只能拿 logprobs 就用它排
   review，不讓 confidence 自動改字。
5. **首次未知詞**：保留候選並請人確認；確認後只影響後續 vocabulary version。
6. **長期適配**：有足夠跨會議人工資料後，再評估 Qwen full fine-tune、
   Azure Custom Speech 或 NeMo adapters。

若目標是接近或超過 PLAUD，真正可持續的優勢不是背下單一錄音的一個答案，
而是讓任何企業在下一場會議前，都能把自己原本就知道的產品、客戶、縮寫與
議程安全地送進 ASR；對第一次出現且無法由聲音區分的同音詞，系統誠實地讓人
確認並在下一次自動正確。
