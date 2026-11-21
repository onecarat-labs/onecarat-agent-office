---
name: office
description: Start/stop/status of Onecarat Agent Office, a small always-on-top window that shows Claude Code's agents at work (e.g. 「Onecarat Agent Officeを起動して」). Windows only.
argument-hint: "[start|stop|status|check]"
allowed-tools: Bash(node --version), PowerShell(node --version), Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" start), Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" start --port 47822), Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" start --port 47823), Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" stop), Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" status), Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" check), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" start), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" start --port 47822), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" start --port 47823), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" stop), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" status), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" check)
---

# Onecarat Agent Office

Onecarat Agent Office is a **watch-only** companion for Windows. It opens a small always-on-top window at the top right of the screen for each Claude Code session, and draws the main agent and its subagents as stick figures. The window cannot type, send, approve or refuse anything: the user keeps working in Claude Code as usual. It never calls a model, never reads credentials, and keeps events in memory only.

The requested action is: `$ARGUMENTS` (default to `start` when empty).

## 1. Check Node.js first

Run exactly:

```
node --version
```

- If the command is not found, or the major version is below 18: **stop here.** Tell the user, in their language, that Office needs Node.js 18 or newer (the LTS from https://nodejs.org/ is fine), and that on Windows it can be installed with `winget install OpenJS.NodeJS.LTS`. Do **not** install it yourself unless the user explicitly asks. After installing, Claude Code must be restarted so the new `node` is on PATH.
- Otherwise continue.

## 2. Run the launcher

Run exactly one of these (quote the path as shown):

| Action | Command |
|---|---|
| start | `node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" start` |
| stop | `node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" stop` |
| status | `node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" status` |
| environment check | `node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" check` |

Do not run any other commands for this skill, do not add other options (the launcher accepts only `--port N` and refuses anything else), and do not edit any settings file.

## 3. Tell the user

After `start`, tell the user briefly, in their language:

- A small window opened at the top right of the screen and stays on top. It can be moved, resized, put away in the taskbar (minimized) and closed; nothing else can be done with it.
- Each Claude Code session gets its own window; the folder name in the title bar tells them apart.
- When Claude Code waits for an approval, the window shows an amber frame and a banner: "承認待ち" (Japanese) or "Needs your approval" (English). The answer is always given in Claude Code, never in the window. While the window is in the taskbar, its taskbar button lights up instead.
- Closing the last window ends the app. When a session ends, its window says goodbye and closes by itself.
- Figures appear only for subagents Claude Code really starts.

The window and the launcher's messages are in Japanese when the Windows display language is Japanese, and in English otherwise. This is automatic; there is no setting for it.

If `start` reports an error, show it to the user and suggest `node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" check`. If the port is in use, `start --port 47822` (or `start --port 47823`) uses another port.
