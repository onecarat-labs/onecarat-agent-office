# onecarat-agent-office（Claude Code プラグイン）

Claude Code のメインエージェントと、実際に起動されたサブエージェントが働く様子を、画面右上の小さな窓（常に最前面）に棒人間で表示します。Windows 専用。見るだけの窓で、入力・送信・承認はできません。通信は自分の PC 内（127.0.0.1）だけ、イベントはメモリ上にだけ置き、モデルは呼びません。

- 起動: `/onecarat-agent-office:office start`（または「Onecarat Agent Office を起動して」）
- 必要なもの: Windows 10 / 11、Node.js 18 以上

中身:

- `hooks/hooks.json` … 非同期のコマンド Hook。`scripts/forward.mjs` を呼びます。
- `skills/office/SKILL.md` … start / stop / status / check
- `dist/` … 起動用スクリプト `office.mjs` と、小窓アプリ `onecarat-agent-office.exe`。リポジトリの `packages/` と `src-tauri/` から `npm run build:plugin` で作ります。

詳しくはリポジトリの README を参照してください。
