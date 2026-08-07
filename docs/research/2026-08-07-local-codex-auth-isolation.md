# Local Codex 獨立訂閱帳號與 runtime 身分隔離研究

> 研究日期：2026-08-07（Asia/Taipei）
> 範圍：官方 OpenAI Codex 文件、目前工作樹與 live summary-worker。
> 安全界線：未複製或輸出任何 OAuth token、`auth.json` 或其他秘密；只在本機
> 解碼並輸出非秘密的 plan claim，以驗證 Business／Pro 身分隔離。

## 結論

目前**已完成分離**：live `summary-worker` 只將外部 Docker volume
`ai_notetacker_summary_codex_home` 以 read/write 掛載到 `/codex-home`。主機個人
`~/.codex` 不再掛入產品容器；另一個訂閱帳號已透過
`codex login --device-auth` 直接登入該 volume。Business runtime plan claim 為
`team`，主機預設帳號仍為 `pro`。

「Local Codex」是 Codex CLI 在本機容器執行，推理仍使用該 ChatGPT
訂閱帳號，不是離線本地模型。Azure 是否可 fallback 是另一條路由規則；
本隔離方案不需要 Azure，登入、額度或網路失敗都應 fail closed。

## 現況證據

| 證據 | 目前結果 | 影響 |
|---|---|---|
| [docker-compose.yml](../../docker-compose.yml) | 容器固定 `CODEX_HOME=/codex-home`，來源為 external `summary_codex_home` | 部署 shell 的 `CODEX_HOME` 不再影響產品身分 |
| live `docker inspect` | `volume ai_notetacker_summary_codex_home -> /codex-home true` | runtime 已確認使用 read/write named volume，而非 host bind |
| live worker | `codex-cli 0.146.0`、`Logged in using ChatGPT`、plan `team` | Business 工作空間登入與主機 `pro` 登入分離 |
| [codex_transcript_summarizer.py](../../workers/transcription-worker/src/transcription_worker/codex_transcript_summarizer.py) 75–88、317–346 | Codex child 只繼承少量環境，包含 `CODEX_HOME`；同時忽略 user config/rules 並停用 command tools | 換成獨立 `CODEX_HOME` 即可切開身分，不必重寫摘要流程 |
| [Dockerfile](../../workers/transcription-worker/Dockerfile) 1–20 | summary image 內建 Codex CLI，worker 與 host CLI 不需共用安裝或狀態 | 可在一次性同 image 容器內完成獨立登入 |

## 官方支援依據

- [`CODEX_HOME`](https://learn.chatgpt.com/docs/config-file/environment-variables#core-locations)
  是 Codex 的完整狀態根目錄，包含 config、auth、logs、sessions 等；預設才是
  `~/.codex`。獨立 volume 因此是官方狀態邊界。
- [Credential storage](https://learn.chatgpt.com/docs/auth#credential-storage)
  說明 `cli_auth_credentials_store="file"` 會把登入狀態放在
  `CODEX_HOME/auth.json`；該檔案必須視同密碼。容器應明確用 `file`，避免
  OS keyring 行為造成狀態落在 volume 之外。
- [Headless login](https://learn.chatgpt.com/docs/auth#login-on-headless-devices)
  將 `codex login --device-auth` 列為 remote/headless 的優先方式；使用者在瀏覽器
  登入並輸入一次性 code。此功能目前是 beta，且需在個人安全設定或 workspace
  權限啟用。
- [`codex login status`／`codex logout`](https://learn.chatgpt.com/docs/developer-commands?surface=cli#codex-login)
  分別檢查目前驗證方式與清除目前 `CODEX_HOME` 的登入。
- [`codex exec` authentication](https://learn.chatgpt.com/docs/non-interactive-mode#authenticate-in-automation)
  會重用已保存的 CLI 登入；官方把 ChatGPT-managed auth 定位為 trusted runner
  的進階非互動路徑，並提醒不要用於 public／untrusted runner。
- [App Server `account/read`](https://learn.chatgpt.com/docs/app-server#auth-endpoints)
  可只讀回傳 `type`、`email` 與 `planType`，適合私下確認確實是另一個帳號；
  `codex login status` 本身只保證顯示登入方式。

## 已採用的 Docker/runtime 佈局

```text
主機個人 Codex
  ~/.codex                         # 永不掛入產品容器

AI_NoteTacker
  Docker volume: summary_codex_home
    -> summary-worker:/codex-home  # 唯一掛載者，read/write 供 token refresh
  container CODEX_HOME=/codex-home
  cli_auth_credentials_store=file
  forced_login_method=chatgpt
```

Compose 使用 named volume，不再讀取部署 shell 的泛用 `${CODEX_HOME}`：

```yaml
services:
  summary-worker:
    environment:
      CODEX_HOME: /codex-home
    volumes:
      - summary_codex_home:/codex-home

volumes:
  summary_codex_home:
    external: true
    name: ai_notetacker_summary_codex_home
```

Codex 的登入、額度查詢與摘要 invocation 都應明確套用
`cli_auth_credentials_store="file"` 與 `forced_login_method="chatgpt"`。
`CODEX_API_KEY`／`OPENAI_API_KEY` 不應進入 Codex child；目前 child allowlist 已排除它們。

## 安全登入交接

在 Compose 切換前，以與 production 相同的 image 對獨立 volume 執行一次：

```bash
docker volume create ai_notetacker_summary_codex_home

docker run --rm -it \
  --mount type=volume,source=ai_notetacker_summary_codex_home,target=/codex-home \
  --env CODEX_HOME=/codex-home \
  ai_notetacker-summary-worker:latest \
  codex login \
    -c 'cli_auth_credentials_store="file"' \
    -c 'forced_login_method="chatgpt"' \
    --device-auth
```

操作者在自己的瀏覽器明確切到新的訂閱帳號，再完成一次性 code。不要把
browser session、OAuth token 或 `auth.json` 傳給系統或維護者。若 device-code
未啟用，先由帳號／workspace 管理者啟用；本案不採用官方文件中的
「複製 auth cache」fallback，因為那會重新引入憑證搬移與來源混淆。

## 驗證結果

2026-08-07 切換後：

- production Compose 防回歸測試通過，確認 summary worker 只使用指定 external
  volume，Azure summary endpoint/key 仍為空。
- `codex login status` 為 `Logged in using ChatGPT`；runtime plan 為 `team`，主機
  plan 仍為 `pro`。
- `gpt-5.6-luna`、reasoning `max` 最小模型 smoke 成功回覆
  `BUSINESS_AUTH_OK`。
- canonical production recreate 後，mount 為 read/write named volume，worker
  running、restart count 0，control-plane `/health` 回覆 `{"status":"ok"}`。

以下命令保留作後續維運檢查：

1. 確認 mount 已切開；輸出不得包含 `/home/solomon/.codex`，且
   `/codex-home` 應來自 named volume、`RW=true`：

   ```bash
   docker inspect ai_notetacker-summary-worker-1 \
     --format '{{range .Mounts}}{{println .Type .Name .Source "->" .Destination .RW}}{{end}}'
   ```

2. 確認登入方式：

   ```bash
   docker exec ai_notetacker-summary-worker-1 codex login status
   ```

   預期：`Logged in using ChatGPT`。

3. 在私密 terminal 確認帳號身分；只比對結果，不把 email 輸出貼到 ticket/chat：

   ```bash
   printf '%s\n' \
     '{"method":"initialize","id":1,"params":{"clientInfo":{"name":"auth-check","title":"auth-check","version":"1"}}}' \
     '{"method":"initialized"}' \
     '{"method":"account/read","id":2,"params":{"refreshToken":false}}' \
   | docker exec -i ai_notetacker-summary-worker-1 codex app-server --stdio \
   | jq -c 'select(.id == 2) | .result.account | {type,email,planType}'
   ```

   預期：`type="chatgpt"`，email 與 plan 為新的獨立訂閱帳號。

4. Recreate/restart worker 後重跑步驟 1–3，證明登入狀態只由獨立 volume 持久化。

5. 經使用者同意消耗一次訂閱額度後，執行最小模型 smoke：

   ```bash
   docker exec ai_notetacker-summary-worker-1 \
     codex exec --ignore-user-config --ignore-rules \
       --disable shell_tool --disable unified_exec --disable code_mode_host \
       --ephemeral --sandbox read-only --skip-git-repo-check \
       --model gpt-5.6-luna 'Reply exactly AUTH_OK'
   ```

   最後再用一筆受控摘要工作確認 provider audit 是 `local-codex`，且任何失敗
   都沒有 Azure request。

## 回滾與撤銷

- Cutover 驗證失敗時先停止 `summary-worker`，讓摘要工作保持 pending；**不要**
  重新掛回主機 `~/.codex`，也不要改走 Azure。
- 回滾 image／程式時仍保留獨立 volume mount；修正後重新 recreate worker。
- 不必刪除 volume。只有明確要撤銷新訂閱帳號時，才對該獨立 volume 執行：

  ```bash
  docker run --rm \
    --mount type=volume,source=ai_notetacker_summary_codex_home,target=/codex-home \
    --env CODEX_HOME=/codex-home \
    ai_notetacker-summary-worker:latest \
    codex logout
  ```

  此命令不得改成 host bind mount；主機個人登入狀態應始終不受影響。

## 後續維運注意事項

- Device-code 目前仍是 beta；本 Business workspace 已由管理端啟用。
- 官方支援 trusted runner 使用 ChatGPT-managed auth，但沒有把個人 Plus／Pro
  訂閱定義成可多人共用的「service account」；帳號所有權與 workspace 政策仍需
  由訂閱管理者確認。
- live image 目前固定 Codex CLI `0.146.0`，已確認有 `--device-auth`；未來升級 CLI
  後應重跑登入、account identity、持久化與一筆模型 smoke。
- Read/write volume 是 token 自動 refresh 所需；安全邊界應靠獨立 volume、最小掛載
  與 Docker host 權限，而不是把 credential volume 改成 read-only。
