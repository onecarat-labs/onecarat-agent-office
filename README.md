# Onecarat Agent Office CC

English | [日本語](README.ja.md)

> Early release (v0.2.x). Verified on Windows 11 with Claude Code 2.1.319.

**A companion app that turns Claude Code's work into a small office you can watch in your browser.**
The manager (main agent) and the subagents Claude Code **actually starts** appear as stick figures that research, edit and test at their desks, then report back. The chat panel is a **built-in terminal running the real interactive Claude Code**, so you can ask and watch on one screen.

![Office screen](assets/screenshot.png)

**What you need to know first.** Claude Code is Anthropic's AI coding tool that runs in a terminal. Office does not replace it; it runs beside it, so Claude Code must be installed and signed in. While working, Claude Code sometimes hands parts of a job to helper agents (*subagents*); the extra figures in the office are those.

## Install (2 commands)

Run in a terminal:

```
claude plugin marketplace add onecarat-labs/onecarat-agent-office
claude plugin install onecarat-agent-office@onecarat
```

Then ask Claude Code (in the terminal, or in Claude Code's Desktop app):

```
Start Onecarat Agent Office
```

or type `/onecarat-agent-office:office start`. Your browser opens http://127.0.0.1:47821/ (with a per-launch access key; see Privacy).

## Requirements

| | |
|---|---|
| **Node.js** | **18 or newer, required.** It is separate from Claude Code itself. If missing, install the LTS from https://nodejs.org/ (Windows: `winget install OpenJS.NodeJS.LTS`) and restart Claude Code / the Desktop app. |
| Claude Code | 2.1.139 or newer (tested on 2.1.319 only), **installed and signed in**. Office has no account of its own: it uses your Claude Code as it is, and adds no usage or cost |
| OS | **Tested on Windows 11.** macOS / Linux are designed for but not guaranteed until tested. The built-in terminal ships for Windows (x64/arm64) and macOS; on Linux Office runs read-only for now (use Claude Code in your own terminal). |

Installing the plugin without Node.js does not break Claude Code: the hooks are background hooks, so they are only recorded as failed and never block a session. When you start Office, the skill tells you how to install Node.js.

## Use

- **Chat → Terminal**: press "Start Claude Code here". The real interactive `claude` starts in the folder shown (by default, the folder of the session that started Office; "Other folders" switches). "Continue last session" reopens the most recent conversation of that folder (`claude --continue`), and "Pick a past session" shows Claude Code's own list of past conversations in the terminal (`claude --resume`). Type requests and answer permission prompts there, as in any terminal. The office above follows that session. While Claude Code uses the mouse itself, a right click goes to Claude Code only; hold Shift to select text or to open the browser's copy / paste menu.
- Or just use Claude Code as usual: terminal, IDE extension or Desktop app all show up the same way.
- The most active session is shown; switch with the Sessions button on the left.
- Click a figure to see the real events behind its state in the Console panel.
- Stop with "Stop Onecarat Agent Office" or `/onecarat-agent-office:office stop`. Closing the tab does not stop it. When Claude Code in the built-in terminal ends (`/exit`, the Stop button), Office stops by itself a few seconds later; the page keeps the goodbye scene. Sessions in other terminals do not stop Office.

### What the screen promises
- **No fake agents.** A figure appears only for a subagent Claude Code really started.
- **No made-up percentages.** Progress is not available, so only stages are shown (reading, editing, testing…).
- **Success/failure is an estimate** (Claude Code does not report it) and is labelled as such. The high-five is a **visual effect** for an estimated success the manager has received.
- **Permission prompts are always answered by you in Claude Code** (the built-in terminal *is* Claude Code). Office never reads, parses or answers them, and never types for you.
- Chat → History shows the requests and final replies taken from the hooks (read-only).

## How it works

```
Claude Code (terminal / IDE / Desktop app)
   │ official hooks (command, async; registered by the plugin)
   ▼
forward.mjs ── keeps only the fields Office shows, POSTs them (does nothing if Office is not running)
   ▼
bridge (127.0.0.1:47821, memory only) ── events ──▶ Office UI in your browser
   └─ built-in terminal: claude in a pseudo-terminal (node-pty) ◀── WebSocket ──▶ xterm.js
```

- **Office never calls a model.** No Anthropic API, Agent SDK or `claude -p`, so **it adds no extra cost.** Like any plugin skill, its short skill description (a few dozen tokens) is part of each session's context.
- It **never reads credentials** (`~/.claude/.credentials.json` etc.).
- **Settings** (gear icon on the left) has three panes: menu, list and detail. "Office" holds Office's own display settings (theme, motion, language). "Claude Code" lists every place Claude Code reads settings from, grouped by topic, with what each is for, and shows the current content **read-only** when you open it. Secret-looking values and everything under `env`/`headers` are hidden; from `~/.claude.json` only the MCP servers and the current project's permissions are read. Office never edits these files: ask Claude Code to change them.

See [docs/architecture.md](docs/architecture.md) and [docs/security.md](docs/security.md).

## Privacy

- All traffic stays **on your machine** (127.0.0.1). No telemetry, no cloud.
- Prompts, replies, command snippets and **terminal output** are **shown from memory and never written to disk**; they are gone when Office stops (or when you clear them in the UI).
- **One access key per launch** protects everything (events, terminal, controls). The launcher hands it to your browser in the URL fragment (`#t=…`), which is never sent to the server, and the page removes it from the address bar. Nothing prints it. **With the built-in terminal, that key can type into Claude Code: never share the URL.** Details: [docs/security.md](docs/security.md).
- File **contents** are never sent to Office (only file names).

## Update / disable / uninstall

```
claude plugin marketplace update onecarat
claude plugin update onecarat-agent-office@onecarat
claude plugin disable onecarat-agent-office@onecarat    # pause (hooks stop too)
claude plugin uninstall onecarat-agent-office@onecarat
claude plugin marketplace remove onecarat
```

Office never edits `~/.claude/settings.json` directly; removing the plugin removes its hooks. The only file it creates is `%LOCALAPPDATA%\onecarat-agent-office\bridge.json` (port + per-launch access key) while it runs; it is deleted on stop.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Node.js is required" | Install Node.js 18+, restart Claude Code |
| Port 47821 in use | `/onecarat-agent-office:office start --port 47822` |
| Nothing shows up | Sessions started before the plugin was installed are not shown: start a new session. Then check `/onecarat-agent-office:office status` and `claude plugin list` |
| Cannot start after a crash | `/onecarat-agent-office:office stop`, then `start` |
| "No access key" in the page | You opened the URL by hand. Ask "Open Onecarat Agent Office" or run `/onecarat-agent-office:office open` |
| "Built-in terminal is not available" | No node-pty binary for this OS/CPU (Linux today), or no `claude` on PATH (`/onecarat-agent-office:office check` prints which). Office still shows everything; use Claude Code in your own terminal |

## Development

```
npm install
npm test
npm run typecheck
npm run bridge -- --open                                   # bridge from source, opens the built UI with its key
npm run bridge -- --open --dev-origin http://127.0.0.1:5317 --open-base http://127.0.0.1:5317/
npm run dev                                                # (with the line above) Vite dev server on 5317
npm run build:plugin  # regenerate plugin/onecarat-agent-office/dist (CI checks it matches the source)
npm run vendor:check  # dist/vendor/node-pty must equal the upstream npm tarball (CI too)
```

Directories: `packages/domain` (shared model), `packages/adapter-claude-code` (hook normalization), `packages/event-bridge`, `packages/office-ui`, `packages/launcher`, `plugin/onecarat-agent-office` (what is shipped), `docs/` (architecture, security, event support matrix, test plan).

## License

Code: [MIT License](LICENSE).

**The "Onecarat" name, logo and brand assets are not covered by the MIT License.** You may use, modify and redistribute the code, but do not use the Onecarat name or logo in a way that suggests your fork is official.

Claude and Claude Code are products of Anthropic. This project is not an official Anthropic product.
