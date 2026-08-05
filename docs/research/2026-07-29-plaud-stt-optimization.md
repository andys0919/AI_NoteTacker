# PLAUD 語音轉文字優化研究

> 調查日期：2026-07-29
> 本文件第一部分只使用 PLAUD 官方產品、Help Center、Developer Platform、隱私與安全頁面。
> 官方沒有公開的實作細節，不以產品現象、供應商名單或行銷文案反推模型名稱。

## 結論摘要

PLAUD 官方資料顯示，其效果不是只靠一個語音模型，而是依賴完整處理鏈：

1. 針對通話或面對面情境選擇收音模式，搭配多麥克風、波束成形及裝置端 VPU 訊號處理。
2. 上傳前後執行降噪與音訊前處理，再以針對離線、真實環境音訊調整的 ASR 產生逐字稿。
3. 在原始逐字稿階段套用語言設定、自訂詞彙與 speaker diarization。
4. 讓使用者校正 speaker 名稱及文字，再由可選 LLM 與模板產生摘要、Mind Map 和問答。

這代表最值得仿照的是「音訊前處理 → 正確語言 → 原始逐字稿詞彙偏置 → diarization → 可校正證據 → 摘要」的順序，而不是猜測 PLAUD 使用哪個 ASR 模型。[PLAUD Developer Platform](https://dev.plaud.ai/transcription-api) 對硬體、前處理與轉錄鏈有公開描述；但沒有公開實際路由到哪個 OpenAI、Google 或 Microsoft ASR 型號。

## 1. 收音與音訊前處理

### 官方已揭露

- PLAUD 的開發者頁面把品質歸因於硬體與軟體共同作用：多方向麥克風、針對主講者的 beamforming、VPU 即時訊號處理，以及上傳前使用 spectral subtraction 和 adaptive filtering 清除背景噪音、空調聲與人群聲。[Transcription API](https://dev.plaud.ai/transcription-api)
- 同一頁面稱其轉錄模型針對面對面會議、診間和現場環境調整，而非只針對乾淨音訊；PLAUD 開發者首頁則稱 ASR 針對 offline audio data 訓練，以處理背景噪音、重疊說話和遠距收音。[Transcription API](https://dev.plaud.ai/transcription-api)、[Developer Platform](https://dev.plaud.ai/)
- Plaud Note 公開規格為 2 MEMS 麥克風及 1 VPU，面對面收音距離約 3 公尺，並把面對面錄音與電話錄音分成不同模式。[Start recording](https://support.plaud.ai/hc/en-us/articles/50826681209113-Start-recording)
- 官方也明確承認音訊品質仍是限制：重疊說話、背景噪音、低音量或距離都可能降低轉錄與 speaker labeling 品質。[Transcribe and summarize](https://support.plaud.ai/hc/en-us/articles/53793130069657-Transcribe-and-summarize)、[Commercial Terms](https://dev.plaud.ai/terms)

### 未揭露，不得推測

- 沒有公開降噪參數、VAD、取樣率轉換、chunk 長度、重疊窗或聲道利用方式。
- 沒有公開哪些前處理只存在於 PLAUD 硬體、哪些也套用於外部匯入的 WAV。
- 「針對真實環境訓練／fine-tuned」是官方產品說法，沒有公開訓練資料、模型結構或可重現評測方法。

## 2. 轉錄與語言支援

### 官方已揭露

- 消費者產品支援 112+ 種語言，可自動偵測主要語言，也可手動指定。繁體中文選項包括 Mandarin、Cantonese 與 Minnan/Hokkien。[How many languages does Plaud support?](https://support.plaud.ai/hc/en-us/articles/53422487420953-How-many-languages-does-Plaud-support-for-transcription)
- 官方建議對較少見語言手動選擇語言，以取得較佳結果；也支援用不同語言設定重新轉錄。[Transcription](https://support.plaud.ai/hc/en-us/articles/51039478667929-Transcription)
- 消費者 App 目前以錄音完成後的處理為主，不提供即時轉錄；PLAUD 將完整上下文的後處理描述為提高準確度與摘要品質的選擇。[Does Plaud support real-time transcription?](https://support.plaud.ai/hc/en-us/articles/54643893661977-Does-Plaud-support-real-time-transcription)
- Developer Platform 宣稱其 Transcription API 回傳含 speaker 標籤的 JSON，並提供 webhook 或 polling 取件。[Transcription API](https://dev.plaud.ai/transcription-api)

### 官方來源間的產品面差異

- Help Center 說消費者產品「每份錄音只轉錄一種語言」，混合語言應選主要語言，其他語段可能較不準。[How many languages does Plaud support?](https://support.plaud.ai/hc/en-us/articles/53422487420953-How-many-languages-does-Plaud-support-for-transcription)
- Developer Platform 則宣稱 API 可支援單一對話中的多語言。[Transcription API](https://dev.plaud.ai/transcription-api)
- Help Center 說消費者產品不做即時轉錄；Developer Platform 的方案頁面另有「live transcription」字樣。[Consumer Help Center](https://support.plaud.ai/hc/en-us/articles/54643893661977-Does-Plaud-support-real-time-transcription)、[Developer Platform](https://eu.plaud.ai/pages/developer-platform)

以上不能合併成同一能力。較合理的讀法是消費者 App 與尚在 early-access／商務接洽階段的 Developer Platform 契約不同，但這仍是推論，必須向 PLAUD 取得實際 API 文件或測試帳號才能確認。

### 未揭露，不得推測

- 沒有公開消費者產品或 API 使用的確切 ASR 模型名稱、版本、模型組合或依語言路由規則。
- 官方隱私資料只揭露 OpenAI、Google、Microsoft 都可能參與 transcription 與 summarization；這不能證明某份中文錄音由哪一家、哪個模型處理。[How your data is used in AI processing](https://support.plaud.ai/hc/en-us/articles/57744162858009-How-your-data-is-used-in-AI-processing)
- Developer Platform 宣稱有依語言與環境發布的 accuracy benchmarks，但目前公開索引頁面沒有提供可核對的 WER、CER、DER 數字、測試集或計算方法。[Developer Platform](https://dev.plaud.ai/)

## 3. Speaker diarization 與姓名標籤

### 官方已揭露

- 轉錄時使用 speaker diarization 自動偵測並分開不同講者，先產生 `Speaker 1` 等標籤；使用者可針對單一段落或相同 speaker 的所有段落改名。[Name Speakers](https://support.plaud.ai/hc/en-us/articles/50635937755161-Name-Speakers)
- speaker 名稱在逐字稿修改後立即更新；若摘要已先生成，必須重新生成摘要才會反映新名稱。[Name Speakers](https://support.plaud.ai/hc/en-us/articles/50635937755161-Name-Speakers)
- Auto speaker labeling 可建立自己的 voice profile，並從使用者過去人工指定的其他 speaker 標籤學習常見講者，之後跨錄音自動套用名稱；官方說辨識效果會隨已處理及已標註錄音增加而改善。[Auto speaker labeling](https://support.plaud.ai/hc/en-us/articles/54027338385177-Auto-speaker-labeling)
- speaker labels 是轉錄階段產生，不能直接補到既有逐字稿；要對舊錄音套用標籤必須重新轉錄。[Auto speaker labeling](https://support.plaud.ai/hc/en-us/articles/54027338385177-Auto-speaker-labeling)
- Developer Platform 稱多方向麥克風、beamforming 及音訊 metadata 有助於 diarization。[Transcription API](https://dev.plaud.ai/transcription-api)

### 未揭露，不得推測

- 沒有公開 diarization 模型名稱、speaker embedding 模型、聚類方法、全域 speaker matching 演算法或是否與 ASR 聯合解碼。
- 沒有公開最大 speaker 數、DER/JER、跨 chunk 合併門檻或中文會議的可重現準確率。
- 「會從已標註錄音學習」不等於 PLAUD 公開允許或描述模型訓練；官方僅描述產品層的 voice profile／label reuse 行為。

## 4. Custom Vocabulary／Glossary

### 官方已揭露

- Custom Vocabulary 先作用於 raw transcript，之後才影響 polished text、summary、outline 與 title；離原始逐字稿越遠，詞彙影響越弱。[Custom vocabulary](https://support.plaud.ai/hc/en-us/articles/50636065290137-Custom-vocabulary)
- 可使用法律、醫療、科技的預設產業詞庫，也可加入名稱、品牌、內部專案、縮寫及多詞詞組；帳號可儲存最多 500 個、區分大小寫的自訂詞。[Custom vocabulary](https://support.plaud.ai/hc/en-us/articles/50636065290137-Custom-vocabulary)
- 詞彙設定套用到之後的新轉錄；既有錄音必須重新轉錄才會套用。[Custom vocabulary](https://support.plaud.ai/hc/en-us/articles/50636065290137-Custom-vocabulary)
- 官方明列限制：沒有「多個錯寫對應同一正字」的 alias mapping，也不接受發音提示；發音差異太大的術語仍可能辨識錯誤。[Custom vocabulary](https://support.plaud.ai/hc/en-us/articles/50636065290137-Custom-vocabulary)
- 官方品質建議把全名與常見稱呼、縮寫與完整名稱、正式拼法與常見變體一併加入，同時改善麥克風距離、噪音與多人同時說話。[Improve transcription accuracy for names and jargon](https://support.plaud.ai/hc/en-us/articles/53693911256089-How-do-I-improve-transcription-accuracy-for-names-and-jargon)

### 官方來源間的數量差異

- Help Center 目前只明列法律、醫療、科技三種預設庫；產品頁面則宣稱有 10+ 個醫療、法律、金融等內建 glossary。[Custom vocabulary](https://support.plaud.ai/hc/en-us/articles/50636065290137-Custom-vocabulary)、[Plaud Intelligence](https://www.plaud.ai/pages/plaud-intelligence)
- 這可能是版本、方案、區域或逐步上線差異，但官方資料未說明；不能把「10+」視為所有帳號都可用的固定契約。

## 5. 摘要、模板與證據鏈

### 官方已揭露

- 摘要是逐字稿的下游輸出。Auto generation 自動選語言、模板和 AI model；Custom generation 讓使用者手動選擇。[Auto generation and custom generation](https://support.plaud.ai/hc/en-us/articles/58029408010137-Auto-generation-and-custom-generation)
- PLAUD 公開支援 GPT、Gemini Pro、Claude Sonnet 等摘要 LLM，實際型號與版本會隨供應商更新，App 內清單才是當下有效值；該頁明確把這些模型描述為摘要模型，不是 ASR 型號。[AI models](https://support.plaud.ai/hc/en-us/articles/55644525081881-AI-models)
- Template Community 宣稱有 10,000+ 個官方與社群模板；使用者也能用文字 prompt 或文件照片建立私人自訂模板。[Summary templates](https://support.plaud.ai/hc/en-us/articles/51041238925081-Summary-templates)、[Custom summary templates](https://support.plaud.ai/hc/en-us/articles/50636094914841-Custom-summary-templates)
- 可為同一份錄音產生不同角度的摘要；Mind Map 由逐字稿及摘要整理主題關係。[Transcribe and summarize](https://support.plaud.ai/hc/en-us/articles/53793130069657-Transcribe-and-summarize)、[Mind Map](https://support.plaud.ai/hc/en-us/articles/57430809095833-Mind-Map)
- Ask Plaud 可對錄音與逐字稿問答，官方稱答案可帶逐字稿片段或時間戳參考。[Transcribe and summarize](https://support.plaud.ai/hc/en-us/articles/53793130069657-Transcribe-and-summarize)
- 編輯逐字稿或 speaker 名稱不會自動重寫已存在的摘要；必須重新產生摘要，且重新轉錄會消耗分鐘並取代原逐字稿、摘要及 notes。[Edit a summary](https://support.plaud.ai/hc/en-us/articles/52090350858905-Edit-a-summary)

### 未揭露，不得推測

- 沒有公開 summary prompt、context window、分段／reduce 策略、引用對齊演算法或防幻覺規則。
- 「grounded」「traceable」「free from hallucinations」屬官方產品宣稱，不等於公開、可重現的 factuality 評測或零幻覺保證。[Plaud Intelligence](https://www.plaud.ai/pages/plaud-intelligence)
- 未公開 Auto generation 如何挑選摘要 LLM，也未公開某個 PLAUD 分享頁實際使用哪個 LLM。

## 6. 長音訊、非同步處理與自動化

### 官方已揭露

- 匯入單檔最長 5 小時；超過 5 小時會自動切成兩個檔案。WAV、MP3、MP4、AAC 等常見格式可匯入，外部檔案完成匯入後走與裝置錄音相同的轉錄、摘要和模板流程。[Audio import](https://support.plaud.ai/hc/en-us/articles/50609466994713-Audio-import)
- Plaud Note 可連續錄音約 30 小時，但這是硬體續航，不代表單一轉錄工作可處理 30 小時。[Continuous recording](https://support.plaud.ai/hc/en-us/articles/50837192822297-Does-the-Plaud-Note-support-continuous-recording)
- AutoFlow 可依錄音前 60 秒的關鍵字、時長或來源觸發轉錄與摘要，並指定模板、speaker labeling、音訊語言及 AI model；內容需超過 200 字（官方約估 5 分鐘）才會觸發。[AutoFlow](https://support.plaud.ai/hc/en-us/articles/50835520394009-AutoFlow)
- Developer Transcription API 公開 webhook 與 polling 兩種取件方式；polling 在處理中回 `202`，完成回 `200`，建議每 5–10 秒查詢。Webhook 宣稱會驗 HMAC，失敗時最多自動重試 3 次並採 exponential backoff。[Transcription API](https://dev.plaud.ai/transcription-api)
- 靜音仍計入轉錄分鐘；官方建議先用 Smart Clip 或手動裁切靜音再轉錄。[Avoid wasting transcription time](https://support.plaud.ai/hc/en-us/articles/54804089816473-If-I-forget-to-stop-recording-will-it-waste-my-transcription-time-How-can-I-avoid-it)

### 未揭露，不得推測

- 沒有公開消費者產品的端到端處理時間、real-time factor、queue time、chunk 並行度或長音訊 stitching 方法。
- Developer API 的「從 recording sync completion 到 webhook 小於 2 秒」描述的是完成後交付延遲；不能當成整份音訊在 2 秒內完成 ASR 的證據。[Transcription API](https://dev.plaud.ai/transcription-api)
- 沒有公開 consumer app 對暫時性 4xx/5xx、模型逾時或部分 chunk 失敗的重試策略。

## 7. 隱私、安全與品質責任

### 官方已揭露

- 預設資料留在裝置；Private Cloud Sync 需主動開啟。即使關閉雲端同步，使用者要求轉錄或摘要時，仍會按需把必要音訊或文字送至 AI provider，回傳後不在 PLAUD server 保留持久副本。[AI Data Usage Transparency Policy](https://global.plaud.ai/pages/ai-data-usage-transparency-policy)、[How your data is used in AI processing](https://support.plaud.ai/hc/en-us/articles/57744162858009-How-your-data-is-used-in-AI-processing)
- 官方列出的 AI providers 是 OpenAI、Google、Microsoft，並稱企業契約要求 zero retention、不得訓練、不得保留 debugging log。[How your data is used in AI processing](https://support.plaud.ai/hc/en-us/articles/57744162858009-How-your-data-is-used-in-AI-processing)
- 官方政策稱傳輸使用 TLS 1.2 以上、靜態資料使用 AES-256 或同等加密；區域儲存包含美國、德國、日本、新加坡。[AI Data Usage Transparency Policy](https://global.plaud.ai/pages/ai-data-usage-transparency-policy)
- PLAUD 公開宣稱具 ISO 27001、ISO 27701、SOC 2 Type II、GDPR、HIPAA 與 EN 18031 等認證／合規文件，正式文件需由 Trust Center 取得。[Security and compliance](https://support.plaud.ai/hc/en-us/articles/57744166222489-Plaud-s-security-and-compliance)
- 商用條款明確警告自動轉錄與 AI 輸出可能錯誤或不完整，準確度依賴音訊品質、口音、背景噪音與領域術語，重要用途仍需人工覆核。[Commercial Terms](https://dev.plaud.ai/terms)
- 同一份商用條款禁止用 PLAUD SDK 建立競爭性的 AI note-taking、
  transcription 或 summarization 產品，也禁止 scraping／reverse engineering
  其底層模型。本文因此只使用公開資料建立獨立 benchmark 假說，不使用 PLAUD
  SDK、私有協定或逆向結果實作替代品。[Commercial Terms](https://dev.plaud.ai/terms)

## 8. 對 AI_NoteTacker 的可驗證優化方向

以下是由官方披露直接支持的工程假說，不表示 PLAUD 的內部程式碼就是這樣：

| 優先度 | 可驗證方向 | 官方依據 | 驗收方式 |
|---|---|---|---|
| P0 | 在 ASR 前固定做音量、靜音、噪音及收音品質檢查，保留原始 WAV | PLAUD 把 VPU、beamforming、降噪與真實環境調整列為品質來源 | 同一正確 WAV 做 ablation；比較 CER、術語命中、漏字與處理時間 |
| P0 | 使用者已知語言時明確指定繁體中文／Mandarin，不讓 Auto 決定 | PLAUD 官方建議手動匹配語言以提高準確度 | 同一音訊比較 Auto 與固定語言，逐字核對術語及中英夾雜 |
| P0 | 詞彙偏置必須作用在 raw transcript 階段，摘要不得自行「猜正」 | PLAUD 的 Custom Vocabulary 首先作用於 raw transcript | 用未見過的專業術語集測試 ASR 前偏置與摘要後修字，要求保留證據 |
| P0 | diarization 與 speaker identity 分層：先分群，再由人工名稱／voice profile 跨檔對應 | PLAUD 把 diarization、人工命名、跨檔 auto labeling 分成不同能力 | 分別計算 DER／speaker coverage 與 identity accuracy，不混成一個分數 |
| P1 | 長音訊採非同步 job、可恢復狀態、有限重試；不要把交付 webhook 當 ASR 本身 | PLAUD API 使用 `202/200`、webhook、HMAC 與 3 次 exponential-backoff retry | 故障注入 400/429/5xx/timeout，確認只重試可重試失敗且不重複寫入 |
| P1 | 逐字稿與 speaker 人工校正後才重生摘要；原始證據不可被覆蓋 | PLAUD 編輯逐字稿／speaker 後需重新生成摘要 | 摘要每個決議、待辦與姓名可回指校正後片段及時間戳 |
| P1 | 用固定模板分開決議、待確認、風險、行動項目，並允許多視角摘要 | PLAUD 以模板與 multidimensional summaries 控制輸出結構 | 以人工標註 golden set 評分 supported/unsupported claims |

最小而有效的差距閉合順序應是：

1. 先驗證正確 WAV 的音訊前處理與固定語言。
2. 再驗證 raw-transcript 階段的通用詞彙來源與偏置，不做固定錯字替換表。
3. 把 speaker 分群品質和人物身分辨識分開評測。
4. 最後才比較摘要 LLM；摘要模型不能挽救上游已錯聽的術語。

## 9. 尚待 PLAUD 官方補證的問題

若要精確複製或公平 benchmark，仍需 PLAUD 提供：

- 每個語言／環境的公開 benchmark 原表、資料集、WER/CER/DER 定義與版本日期。
- 消費者產品與 Developer API 的單語／多語及 realtime 能力差異。
- 外部 WAV 是否套用與 PLAUD 裝置錄音完全相同的前處理和 metadata。
- 中文錄音實際 ASR provider/model、模型版本固定方式及路由切換條件。
- 最大 speaker 數、跨 chunk speaker 合併及跨錄音 voice profile 的契約。
- Custom Vocabulary 是解碼期 bias、後處理校正，或兩者並用。
- 端到端處理時間、queue SLA、暫時性錯誤重試與 partial-result 恢復行為。

## 10. GitHub／開源方案研究

以下只說明各開源專案公開提供的能力，不代表 PLAUD 使用這些專案。
Repository 活躍度與授權狀態核對日期為 2026-07-29；模型權重可能另有授權，
導入前仍須逐一確認 model card。

| 候選 | 官方公開能力 | 對目前缺口的價值 | 限制／授權 | 建議 |
|---|---|---|---|---|
| [Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR) | 0.6B／1.7B，支援中文、粵語、閩南語等 22 種中文方言、長音訊、offline／streaming；另有支援五分鐘中文音訊的 0.6B forced aligner | 目前最值得先驗證的中文文字候選；forced aligner 的五分鐘上限也吻合現有 chunk 邊界 | Apache-2.0；沒有在官方 repo 找到 hotword／custom-vocabulary 契約；官方 WER 是供應商評測，不能套用到 HDD WAV | **第一順位，同一 WAV oracle-free A/B** |
| [FunASR](https://github.com/modelscope/FunASR) | 中文 Paraformer／Fun-ASR／SenseVoice、FSMN-VAD、中文標點、CAM++ speaker、hotword、OpenAI-compatible service | 最接近 PLAUD「中文 ASR + raw-stage vocabulary + diarization」的一體式本機實驗 | Toolkit 為 MIT，模型權重各自授權；模組組合多，容易把部署複雜度誤當品質 | **第二順位；專門驗證中文術語與 speaker** |
| [pyannote.audio](https://github.com/pyannote/pyannote-audio) | 本機 `community-1` diarization、speaker embeddings；官方另有 premium diarization／voiceprinting | 可把 speaker 分群與 ASR 文字分開，建立跨錄音 voice profile，避免受 Azure 四個 reference 上限綁住 | 程式碼 MIT；`community-1` 需接受模型條款及 Hugging Face token；官方 AliMeeting DER 不能和目前 PLAUD-relative agreement 直接比較 | **第一順位 speaker A/B** |
| [WhisperX](https://github.com/m-bain/whisperX) + [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | VAD、batched Whisper、word-level forced alignment、pyannote diarization；faster-whisper 以較少記憶體加速相同 Whisper 模型 | 可改善切點、時間戳和 speaker 對齊，可能提高目前 37.6% attributed-segment coverage | WhisperX 官方承認 overlapping speech 處理不佳、diarization 並不完美；faster-whisper 主要是速度，不是新的文字模型 | **對齊基準，不是 `蛇片` 修復方案** |
| [WeNet](https://github.com/wenet-e2e/wenet) | production-oriented streaming／non-streaming ASR、中文 Paraformer／WeNetSpeech、LM integration | 可作為另一個中文專用模型對照 | Apache-2.0；需要額外 runtime／模型選型，現階段沒有比 Qwen3-ASR 或 FunASR 更短的驗證路徑 | Qwen／FunASR 都未過 gate 時再測 |
| [NVIDIA NeMo Speech](https://github.com/NVIDIA-NeMo/Speech) | ASR 訓練、微調、diarization，以及不重訓模型的 [phrase boosting](https://docs.nvidia.com/nemo/speech/nightly/asr/asr_customization/word_boosting.html) | 適合日後有人工標註語料時做真正的 domain adaptation | Apache-2.0，但 framework、模型與訓練成本最高 | 沒有 golden corpus 前不導入 |
| [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | 離線 ASR、VAD、hotword、speaker identification／diarization、speech enhancement，多平台 ONNX runtime | 若未來要離線、edge 或統一跨平台 runtime，功能完整 | Apache-2.0；實際品質完全取決於所選模型，功能多不等於更準 | Edge 需求出現時再評估 |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | Whisper 的輕量 C/C++ runtime、量化、GPU／CPU／edge、VAD | 部署簡單、離線可攜 | MIT；仍是 Whisper 權重，不能期待僅更換 runtime 修復專業術語 | 不列入文字品質第一輪 |

### 為何 Qwen3-ASR 應先測

> **完整實測更新：** Qwen3-ASR 1.7B 已跑完正確的 5,609.52 秒 WAV。60 秒
> 切片加 content gate 約 201.1 秒完成，成功攔截並用兩個 30 秒 retry 恢復
> 一次 repetition failure；但沒有輸出原始影片明列的 `Tray盤`，因此只通過
> staging 速度／穩定性 gate，沒有通過 production terminology gate。詳見
> [完整 ASR 驗證](2026-07-29-full-asr-validation.md)。

Qwen3-ASR 官方 repo 的供應商評測，在其內部 `Dialog-Mandarin` 測試中，
列出的 WER 是 `gpt-4o-transcribe` 20.73、Qwen3-ASR-1.7B 6.54；後者低
約 68.5%。同一 repo 也列出閩南語支援及五分鐘中文 forced alignment。
這些數字只足以支持「值得測」，不能證明 HDD 會議也會改善 68.5%，因為
資料集、錄音環境、術語及評分實作都不同。

目前主機的 RTX 5080 有 16 GB VRAM，具備做 1.7B 模型隔離 A/B 的基本條件。
先以獨立容器測試，不把 Qwen runtime 或依賴塞進現有 transcription-worker。

### 最小同音訊驗證順序

1. 固定使用 operator 指定的正確 WAV 與已比較過的同一個五分鐘區段。
2. 第一輪不提供 PLAUD 文字、人工答案、phrase list 或由該錄音衍生的詞彙：
   比較現行 `gpt-4o-transcribe`、Qwen3-ASR-1.7B、FunASR 中文候選。
3. 先建立人工核對的短區段 golden transcript，再計算中文 CER、漏字、
   unsupported text、`Tray盤／MoveIn／MES3／MVS／條碼` 等術語、延遲及
   VRAM；PLAUD 只作
   comparison candidate，不能當 ground truth。
4. 只有候選在文字 gate 勝出，才跑完整 5,609.52 秒 WAV；失敗就停止，
   不新增 provider abstraction。
5. 第二輪才使用「錄音前已存在」的組織／帳號詞彙，測 FunASR hotword 或
   現有 glossary prompt。不得拿 PLAUD 或 target transcript 的答案回填，
   並須量測錯誤插入及同音詞 collateral damage。
6. speaker 另跑 pyannote `community-1` 與 Qwen forced aligner，使用人工標註
   的 10–15 分鐘 speaker sample 計算 DER／coverage／identity accuracy；
   任何 speaker pipeline 都不得改寫文字。

## 11. 建議的 PLAUD-like 最小產品方向

PLAUD 公開能力與目前程式的差距，主要不是少一個摘要模型：

1. **帳號／組織級詞彙庫**：目前只有 per-upload glossary。應把人工接受的
   名稱、產品、客戶與縮寫放入可管理、可刪除、可 version 的 bounded library，
   在建立 job 時 snapshot；這是通用邏輯，不是硬編碼 HDD 詞表。
2. **人工 correction loop**：允許逐字稿及 speaker 改名，保留 immutable
   provider raw evidence；使用者明確接受後才把新詞加入詞彙庫，並重新生成摘要。
3. **跨錄音 voice profile**：把 diarization 和 identity 分開。由明確同意的
   speaker sample 建立 embedding／reference；低於門檻時回退匿名 speaker，
   不猜姓名。
4. **claim-level evidence**：摘要的 decision、action item、risk 和 open question
   應回指 segment／timestamp。這能保留目前 Sol 比 PLAUD 更保守的優勢，同時
   補上 PLAUD 的可追溯問答體驗。
5. **條件式音訊 enhancement**：先測 SNR、音量、clipping、silence 和 channel；
   只有品質 gate 不合格才跑降噪，因為一律 enhancement 也可能破壞子音與術語。

因此建議的最短路徑是：

`Qwen3-ASR oracle-free A/B → FunASR vocabulary A/B → pyannote/Qwen alignment speaker A/B → 只實作勝出的 provider 與 persistent correction loop`

不建議現在建立 PLAUD 式「三家 provider 永遠全跑」的 ensemble。PLAUD 官方
只證明其供應商清單包含 OpenAI、Google、Microsoft，沒有證明每份錄音會同時
呼叫三家或以投票合併結果。
