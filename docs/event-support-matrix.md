# Event Support Matrix — Onecarat Agent Office CC

検証環境：Windows 11 Home 10.0.26200 / Claude Code **2.1.319** / Node 24.19.0（2026-11-08）

状態の定義：
- `supported` … 手元のバージョンで**実機確認済み**
- `partial` … 実機で一部確認、または制約付き
- `not_yet_verified` … 公式Docsに記載あり／コード上は可能そうだが、実機未確認
- `unsupported` … 取得できない、または採用しない

## 1. イベント取得経路

| 経路 | 状態 | 根拠 / 備考 |
|---|---|---|
| HTTP Hook（`type:"http"`）→ 127.0.0.1 | `supported`（**不採用**） | PreToolUse / PostToolUse / PostToolUseFailure / SubagentStart / SubagentStop / UserPromptSubmit / Stop / PermissionRequest / Notification / SessionEnd を受信した。ただし Office が停止しているあいだ、ツール呼び出しのたびに hook error が出るので使わない |
| HTTP Hook の `SessionStart` | `unsupported`（**仕様どおり**） | Hooks リファレンス：「Only `type: "command"` and `type: "mcp_tool"` hooks are supported」。実機でも届かず、command hook では届いた |
| command hook（exec 形式の `node` + `args`）→ 転送スクリプト | `supported`（**採用：主経路**） | `plugin/onecarat-agent-office/scripts/forward.mjs`。Office の停止中も exit 0 で終わり、**hook error は出ない**。同期だと1回あたり約 **94ms**（node の起動時間） |
| command hook の `async: true` | `supported` | 2秒待つ Hook で実測した：同期ではツールの実行が Hook 開始の 2125ms 後（待たされる）、async では 805ms 後（待たない）。到着順は保証されないので、ブリッジが Hook の開始時刻で並べ直し、`tool_use_id` で Pre と Post を対応付ける |
| async hook で実行ファイルが無い（Node 未導入） | `supported` | 同期の Hook は `hook_non_blocking_error` になる。async の Hook は `async_hook_response`（exitCode 1）として記録されるだけ。通常の表示にエラーが連発することはない見込み（画面での目視はしていない） |
| command hook の `SessionEnd` | `partial` | pty の kill で終了させた場合は届かなかった（SessionEnd の 1.5 秒の予算と node の起動時間の兼ね合いと推定）。同じ時刻の HTTP hook は届いた。内蔵ターミナルの「終了」ボタンも kill なので、届かない見込み |
| Mod（プラグインの in-process JS hook、`classic.*`）→ `$.http.fetch` | `supported`（**不採用：イベント受信には使わない**） | `--plugin-dir` で読み込み、`classic.SessionStart` / `classic.SessionEnd` を受信した（UA `Bun/…`） |
| `--settings <file>` で起動時に Hook を注入 | `supported` | 利用者の設定に触れずに Hook を付けられた（いまの Office は使っていない） |
| プロジェクトの `.claude/settings.local.json` の Hook | `supported` | **実行中のセッションにすぐ反映される**（再起動は不要） |
| プラグインの Hook（marketplace から導入） | `supported` | 導入後の新しいセッションで `SessionStart` が届いた。アンインストールすると外れる |
| Desktop app のセッション | `supported` | トランスクリプトの `entrypoint: "claude-desktop"` を確認。SessionStart（command）、UserPromptSubmit、PreToolUse/PostToolUse（Agent、Read、SubagentHandback）、SubagentStart/Stop（`agent_id` 付き）、Stop（`last_assistant_message` あり）が**ターミナルと同じ形式**で届いた。hook error は0件 |
| IDE 拡張（VS Code）のセッション | `not_yet_verified` | Docs：同じ設定ファイルを読む |

## 2. フィールド

| 項目 | 状態 | 根拠 / 備考 |
|---|---|---|
| `session_id`（全イベント） | `supported` | 複数のセッションが別々の ID で届き、混ざらなかった |
| `agent_id` / `agent_type`（サブエージェント内のツール呼び出し） | `supported` | サブエージェントの PreToolUse/PostToolUse に付く。メインのツール呼び出しには付かない |
| サブエージェント ↔ 親の Agent ツール呼び出しの対応 | `partial` | SubagentStart に `tool_use_id` は無い。親の `PostToolUse(Agent)` の `tool_response.agentId` が `agent_id` と一致するので、これで紐付ける |
| `permission_mode` | `supported` | メインエージェントの Hook に、その時点のモード（`default` / `acceptEdits` / `auto` など）が入る。**`Shift+Tab` で切り替えただけでは Hook が発火しない**ので、表示に反映されるのは次の依頼やツール実行のとき |
| `SubagentStop.last_assistant_message` | `partial`（**handback 固有、仕様どおり**） | Hooks リファレンス：v2.1.271 以降、`SubagentHandback` で報告した子の `last_assistant_message` は報告後の締めのテキスト（あれば）で、報告本文ではない。本文は `SubagentHandback` の `tool_input.message`。handback を使わない子には最終応答が入る（Desktop app の Explore 子で確認） |
| `SubagentStop` の成功／失敗 | `unsupported` | 成否のフィールドは無い。成否は「報告あり、かつ直前のツール失敗なし」などからの**推定**になるので、UI でも「推定」と表示する |
| 内部エージェントの `SubagentStop` | 注意 | 対応する SubagentStart の無い SubagentStop（`agent_type` は空）を観測した。**SubagentStart を見ていない agent_id は無視する** |
| `Stop.last_assistant_message` | `supported` | 最終応答のテキストを受信した |
| `UserPromptSubmit.prompt` | `supported`（要フィルタ、**仕様どおり**） | リファレンス：スケジュールタスク／`/loop`、バックグラウンドのサブエージェントの報告、ほかのセッションからのメッセージでも発火する。実機でも `<agent-message …>` で始まる本文を観測した。Chat の表示ではフィルタしている |
| `PostToolUseFailure.error` | `supported` | 失敗した Bash で確認した |
| `PostToolUseFailure.is_interrupt`（中断） | `not_yet_verified` | フィールドはあるが、実機での中断は確認していない |
| `PermissionRequest` + `Notification(permission_prompt)` | `supported` | `default` モードで Write を要求させると、両方届いた。Office は承認プロンプトに応答せず、ファイルも作られなかった |
| `Notification` の `idle_prompt` / `agent_completed` など | `not_yet_verified` | Docs に記載あり |
| 報告の受領（ハイタッチの根拠） | `supported` | 3つの経路を実機で確認した：(1) 子の `PostToolUse(SubagentHandback)`（ターミナル、ターン中）、(2) `UserPromptSubmit` の `<agent-message from="<id>">`（ターミナル、待機中）、(3) `UserPromptSubmit` の `<task-notification><task-id><id></task-id>`（Desktop app、handback を使わない子） |
| Desktop app の内部ツール `mcp__ccd_turn__*` | 注意 | Desktop app が各ターンで `update_plan` / `wrap_up` を呼ぶ。Office では「考え中」に分類する |
| 許可待ち（Desktop app、Manual モード） | `supported` | `PermissionRequest(Write)` → 6秒後に `Notification(permission_prompt)` → 利用者が Desktop で許可 → 28秒後に `PostToolUse(Write)`。Office は応答していない |
| 同時に2セッション（ターミナル + Desktop app） | `supported` | 別のセッションとして表示され、混ざらなかった |
| `TaskCreated` / `TaskCompleted` | `not_yet_verified` | Docs：`task_id`、`task_subject`、`task_description?`、`teammate_name?`、`agent_id?`。実機では発火させていない |
| `MessageDisplay`（ストリーム） | `not_yet_verified` | Docs：ストリーム中に発火し、既定のタイムアウトは10秒。負荷が高いので使わない |
| `StopFailure`（API エラー） | `not_yet_verified` | Docs に記載あり。失敗の表示に使える候補 |
| ヘッダーでの環境変数の補間（`allowedEnvVars`） | `supported` | 列挙すると値が入り、列挙しないと空文字になる（HTTP hook。いまは使っていない） |
| 進捗率 | `unsupported` | どのイベントにも無い。段階の表示と、終わりの見えない進捗表示だけにする |

## 3. Chat 入力

| 方式 | 状態 | 根拠 / 備考 |
|---|---|---|
| B1：内蔵ターミナル（node-pty + xterm.js で対話型 `claude` を動かす） | `supported`（**採用**） | Windows 11 で実機確認した：`claude` の画面が xterm に出る。依頼 → サブエージェント2体 → 報告 → マネージャーの受領まで、同じ画面で完結した |
| B1：承認プロンプトの操作 | `supported` | 手動モードで編集を依頼すると承認待ちになり、ターミナルでキーを押して許可できた（矢印・Enter・Esc） |
| B1：日本語入力 | `supported` | IME の入力が文字化けも二重入力もせずに届いた |
| B1：Hook の `session_id` と端末の対応 | `supported` | `claude --session-id <uuid>` で起動すると、Hook の `session_id` が一致する。UI はこの ID でセッションを追いかける |
| B1：環境変数の継承 | 注意（**対処済み**） | Claude Code の中から起動すると、呼び出し元の印と私的な通信路（`CLAUDE_CODE_SESSION_ID`、`CLAUDE_CODE_MESSAGING_*` など）を引き継いでしまう。Office は起動時にそれらを外し、利用者の設定（`CLAUDE_CONFIG_DIR` など）は残す |
| B1：許可モード | 注意 | Office はモードを渡さない。内蔵の `claude` は利用者のアカウントや設定の既定モードで起動する（auto が既定のアカウントなら auto）。UI には Hook の `permission_mode` を表示する |
| B1：node-pty の prebuild | `partial` | 同梱：win32-x64/arm64、darwin-x64/arm64（上流の npm パッケージのまま）。**実機で確かめたのは win32-x64 だけ**。Linux は上流に prebuild が無いので、内蔵ターミナルは使えず読み取り専用で起動する |
| B1：ブラウザへのキーの受け渡し（Windows） | 注意（**対処済み**） | `explorer.exe` で URL を開くと `#` 以降が落ちた。`rundll32 url.dll,FileProtocolHandler` では渡った |
| Desktop app の内蔵ブラウザで Office を表示 | `supported` | localhost のページを表示できた（キーは渡らないので「キーなし」の表示になる） |
| B2：Mod の `$.prompt.fill`（Claude Code の入力欄に下書きを入れる） | `supported`（**任意の追加機能の候補**。いまは実装していない） | ブリッジの文字列が TUI の入力欄に入り、`{isFilled:true}` が返った。送信はしない（Enter は利用者が押す） |
| B2：Mod の `$.prompt.submit`（自動送信） | `not_yet_verified` | 型定義で存在は確認した。**採用しない**（最後の確定は利用者が操作する、という原則のため） |
| B2：Desktop app / VS Code での mod | `not_yet_verified` | Docs：terminal は v2.1.287+、Desktop は v2.1.286+、VS Code はチャットパネルで動く。WSL では動かない |
| Agent SDK / `claude -p` / OAuth の流用 / TUI の解析による承認の代行 | `unsupported` | 規約と目的の両面から採用しない |

## 4. 最小対応バージョン

| 機能 | 最小バージョン | 根拠 |
|---|---|---|
| Office（command hook、内蔵ターミナル） | **2.1.139** | Changelog：exec 形式の `args` が追加されたのが 2.1.139（必須機能の中で最も新しい）。ほかの必須機能は `last_assistant_message` が 2.1.47、`agent_id`/`agent_type` が 2.1.69、`async` hook は 2.1.75 より前からある。**2.1.139 での実機確認はしていない**（確認済みは 2.1.319 のみ） |
| Mod（B2 を作る場合） | **2.1.287** | mods の Docs：terminal は v2.1.287+、Desktop は v2.1.286+ |
