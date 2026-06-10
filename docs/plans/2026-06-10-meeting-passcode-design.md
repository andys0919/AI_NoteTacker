# 會議密碼(Meeting Passcode)支援設計

日期:2026-06-10

## 背景

Zoom 會議連結若未含 `?pwd=` 參數且會議設有密碼,Zoom Web Client 的加入頁會多出必填的
「會議密碼」欄位,「加入」按鈕維持 disabled。ZoomBot 原本只填名稱欄位,點擊加入按鈕
逾時(30 秒)後重試三次,最後以籠統的 `meeting-bot-failed` 失敗,操作者無從得知原因
(實例:job_ed74b08e0d3a473093892e6141be4811)。

## 目標

1. 主頁表單可選填會議密碼,密碼一路傳遞到 ZoomBot 並填入 Zoom 的密碼欄位。
2. 缺密碼或密碼錯誤時快速失敗,控制台顯示明確、可行動的中文訊息。
3. 密碼不得從 operator/admin API 回流到瀏覽器。

## 資料流

```
index.html(會議密碼欄位)
  → POST /api/operator/jobs/meetings(meetingPasscode,zod trim/max 64)
  → recording_jobs.meeting_passcode(TEXT,ADD COLUMN IF NOT EXISTS migration)
  → POST /recording-workers/claims 回應(toWorkerClaimResponse 才帶 meetingPasscode;
    toApiRecordingJob 不帶,前端拿不到)
  → recording-worker screenapp executor(body.meetingPassword,僅有值時)
  → meeting-bot /zoom/join(mount-patch zoom-route.js 轉傳 meetingPassword)
  → ZoomBot.joinMeeting 填入 #input-for-pwd
```

## ZoomBot 行為(ops/meeting-bot/ZoomBot.js + zoom_passcode.cjs)

- `resolveZoomPasscodePlan({ passcodeFieldVisible, providedPasscode })`:
  - 無密碼欄位 → `none`(照舊)
  - 有欄位、有密碼 → `fill`(填入 trim 後密碼)
  - 有欄位、無密碼 → `fail`:addBotLog(error, JoinRequest/PasscodeRequired,中文訊息)
    後丟錯。control-plane 既有機制把 error log 轉成
    `meeting-bot-join-request-passcode-required` + 訊息直接顯示在儀表板。
- 名稱欄位改用 `#input-for-name`(fallback `input[type="text"]`),修正有密碼欄位時
  名稱填錯欄位的問題。
- 等待室輪詢加 `detectZoomPasscodeError(bodyText)`(中英文「密碼錯誤」文案),命中時
  回報 JoinRequest/PasscodeIncorrect 並丟錯,不再空等 lobby timeout。

## 不做的事(YAGNI)

- Google Meet / Teams 不使用密碼欄位(欄位通用,但僅 Zoom bot 消費)。
- 重新送出時不回填密碼(API 不回傳密碼,屬刻意的安全取捨)。
- 不在提交時驗證 Zoom 是否真的需要密碼。

## 測試

- control-plane:API 接受/trim 密碼、claim 帶出、operator API 不洩漏、pg-mem 持久化。
- recording-worker:executor 有密碼帶 `meetingPassword`、無密碼不帶。
- zoom_passcode.cjs:plan 三態與錯誤文案偵測(test/zoom-passcode.test.ts)。
