# Onecarat Agent Office CC

[English](README.md) | 日本語

> 早期公開版（v0.2.x）。Windows 11 と Claude Code 2.1.319 で動作を確認しています。

**Claude Code の作業を、ブラウザの小さなオフィスで「見える化」するコンパニオンアプリです。**
マネージャー（メインのエージェント）と、Claude Code が**実際に起動した**サブエージェントが、棒人間としてデスクで調査・編集・テストをし、終わると報告します。チャット欄は**本物の対話型 Claude Code が動く内蔵ターミナル**なので、依頼と観察が1つの画面で済みます。

![Office の画面](assets/screenshot.png)

**はじめに。** Claude Code は、Anthropic のターミナルで動く AI コーディングツールです。Office はそれを置き換えるものではなく、隣で動くコンパニオンです。Claude Code がインストールされ、サインイン済みであることが前提です。Claude Code は作業の一部を補助のエージェント（**サブエージェント**）に任せることがあり、オフィスに増える棒人間がそれです。

## インストール（2コマンド）

ターミナルで実行します。

```
claude plugin marketplace add onecarat-labs/onecarat-agent-office
claude plugin install onecarat-agent-office@onecarat
```

インストール後、Claude Code（ターミナル版、または Claude Code の Desktop app）で次のように頼むと起動します。

```
Onecarat Agent Officeを起動して
```

`/onecarat-agent-office:office start` と打っても同じです。ブラウザで http://127.0.0.1:47821/ が開きます（起動ごとのアクセス用キー付き。「プライバシー」を参照）。

## 必要なもの

| 項目 | 条件 |
|---|---|
| **Node.js** | **18 以上が必須**。Claude Code 本体とは別に必要です。入っていなければ https://nodejs.org/ の LTS を入れてください（Windows なら `winget install OpenJS.NodeJS.LTS`）。入れたら Claude Code（Desktop app も）を再起動してください。 |
| Claude Code | 2.1.139 以上（動作を確認したのは 2.1.319 のみ）。**インストールしてサインイン済み**であること。Office は自分のアカウントを持たず、あなたの Claude Code をそのまま使うので、利用料が増えることはありません |
| OS | **Windows 11 で動作確認済み**。macOS / Linux は設計上は考慮していますが、実機テストが済むまでは保証しません。内蔵ターミナルは Windows（x64/arm64）と macOS 向けを同梱しています。Linux では当面、読み取り専用で動きます（Claude Code はいつものターミナルで使います）。 |

Node.js が無い状態でプラグインを入れても、Claude Code の動作は止まりません。Hook はバックグラウンドで動くもので、失敗として記録されるだけで、セッションを止めることはありません。Office を起動すると、Skill が Node.js のインストールを案内します。

## 使い方

- **チャット →「ターミナル」**で「ここで Claude Code を開始」を押すと、表示されているフォルダで本物の対話型 `claude` が起動します。既定のフォルダは Office を起動したセッションのフォルダで、「ほかのフォルダ」から切り替えられます。依頼の入力も承認の操作も、ふつうのターミナルと同じようにそこで行います。上のオフィスはそのセッションを追いかけます。
- いつもどおり Claude Code を使うだけでもかまいません。ターミナル、IDE 拡張、Desktop app のどれでも同じように表示されます。
- 画面には、いちばん動いているセッションが表示されます。左の「セッション」ボタンで切り替えられます。
- 棒人間をクリックすると、下の「コンソール」に、その状態の根拠になった実際のイベントが表示されます。
- 停止は `Onecarat Agent Officeを止めて`（または `/onecarat-agent-office:office stop`）です。ブラウザのタブを閉じても Office は止まりません。

### 表示の約束
- **架空のエージェントは出しません。** 棒人間は、Claude Code が実際に起動したサブエージェントの分だけです。
- **進捗率（%）は出しません。** 取得できないためです。表示するのは「調査中」「編集中」「テスト中」などの段階だけです。
- **成功・失敗は推定です**（Claude Code は成否を通知しないため）。画面にもそう表示します。ハイタッチは、推定で成功し、かつマネージャーが報告を受け取った場合の**演出**です。
- **承認の操作は必ず、あなた自身が Claude Code で行います**（内蔵ターミナルは Claude Code そのものです）。Office は承認プロンプトを読まず、解釈せず、応答もしません。あなたの代わりに入力することもありません。
- チャット →「履歴」には、Hook から得た依頼と最終返答を表示します（読み取り専用）。

## 仕組み

```
Claude Code（ターミナル / IDE / Desktop app）
   │ 公式の Hook（command 型・async、プラグインで登録）
   ▼
forward.mjs ── 必要な項目だけを抜き出して POST（Office 停止中は何もしない）
   ▼
ブリッジ（127.0.0.1:47821、メモリ上のみ）── イベント ──▶ ブラウザの Office UI
   └─ 内蔵ターミナル：疑似端末（node-pty）上の claude ◀── WebSocket ──▶ xterm.js
```

- **Office はモデルを呼びません。** Anthropic API、Agent SDK、`claude -p` は使わないので、**追加の利用料はかかりません**。ただし、ほかのプラグインの Skill と同じく、Skill の短い説明文（数十トークン程度）は毎セッションのコンテキストに含まれます。
- 認証情報（`~/.claude/.credentials.json` など）は**読みません**。

詳しくは [docs/architecture.md](docs/architecture.md) と [docs/security.md](docs/security.md)（いずれも英語）を見てください。

## プライバシー

- 通信はすべて**自分の PC の中**（127.0.0.1）だけです。外部送信やテレメトリーはありません。
- プロンプト・応答・コマンドの抜粋・**ターミナルの出力**は、**メモリ上で表示するだけで、ディスクには保存しません**。Office を止めると消えます。画面から消すこともできます。
- イベント・ターミナル・操作のすべてを、**起動ごとに作る1つのアクセス用キー**で守っています。ランチャーはこのキーを URL の `#t=…` の部分に入れてブラウザに渡します。この部分はサーバーに送られず、ページはすぐにアドレスバーから消します。キーがどこかに表示されることもありません。**内蔵ターミナルがあるため、このキーがあれば Claude Code に入力できてしまいます。URL は人に渡さないでください。** 詳しくは [docs/security.md](docs/security.md)（英語）。
- ファイルの**中身**は Office に送りません（ファイル名だけです）。

## 更新・無効化・アンインストール

```
claude plugin marketplace update onecarat           # 一覧を更新
claude plugin update onecarat-agent-office@onecarat # プラグインを更新
claude plugin disable onecarat-agent-office@onecarat   # 一時的に止める（Hook も止まる）
claude plugin uninstall onecarat-agent-office@onecarat # 削除
claude plugin marketplace remove onecarat             # marketplace の登録も消す
```

Office は `~/.claude/settings.json` を直接編集しません。プラグインを外せば Hook も外れます。PC に残るのは、起動中だけ作られる `%LOCALAPPDATA%\onecarat-agent-office\bridge.json`（ポート番号と、起動ごとのアクセス用キー）だけで、停止すると消えます。

## 困ったとき

| 症状 | 対処 |
|---|---|
| 「Node.js が必要」と言われる | Node.js 18 以上を入れ、Claude Code を再起動する |
| ポート 47821 が使用中 | `/onecarat-agent-office:office start --port 47822` |
| 何も表示されない | インストール前に始めたセッションは表示されません。新しいセッションを始めてください。それでも出なければ、状態の確認（`/onecarat-agent-office:office status`）と、プラグインが有効かの確認（`claude plugin list`） |
| 強制終了したあとに起動できない | `/onecarat-agent-office:office stop` で後片付けしてから `start` |
| ページに「キーなし」と出る | URL を手で開いたためです。「Onecarat Agent Officeを開いて」と頼むか、`/onecarat-agent-office:office open` を実行してください |
| 「内蔵ターミナルを使えません」と出る | この OS／CPU 向けの node-pty が無い（いまは Linux）か、PATH に `claude` が無い場合です（`/onecarat-agent-office:office check` でどちらか分かります）。表示はすべて動くので、Claude Code はいつものターミナルで使ってください |

## 開発

```
npm install
npm test            # 単体テスト・ブリッジ・転送スクリプト
npm run typecheck
npm run bridge -- --open                                   # ソースからブリッジを起動し、ビルド済み UI をキー付きで開く
npm run bridge -- --open --dev-origin http://127.0.0.1:5317 --open-base http://127.0.0.1:5317/
npm run dev                                                # （上の行と組み合わせて）5317 番で Vite の開発サーバー
npm run build:plugin  # plugin/onecarat-agent-office/dist を再生成（CI がソースとの一致を確認）
npm run vendor:check  # dist/vendor/node-pty が上流の npm tarball と一致するか（CI でも確認）
```

ディレクトリ：`packages/domain`（共通モデル）、`packages/adapter-claude-code`（Hook の正規化）、`packages/event-bridge`、`packages/office-ui`、`packages/launcher`、`plugin/onecarat-agent-office`（配布物）、`docs/`（アーキテクチャ・セキュリティ・機能対応表・テスト計画）。

## ライセンス

コードは [MIT License](LICENSE) です。

**「Onecarat」の名称・ロゴ・ブランド素材は MIT ライセンスの対象外です。** コードは自由に使って・改変して・配布してかまいませんが、派生物で Onecarat の名称やロゴを、公式であるかのように使わないでください。

Claude および Claude Code は Anthropic の製品です。本プロジェクトは Anthropic の公式製品ではありません。
