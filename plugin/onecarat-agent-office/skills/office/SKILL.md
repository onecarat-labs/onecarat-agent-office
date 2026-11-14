---
name: office
description: Start/stop/status of Onecarat Agent Office, a local browser view of Claude Code's agents (e.g. 「Onecarat Agent Officeを起動して」).
argument-hint: "[start|stop|status|open|check]"
allowed-tools: Bash(node --version), PowerShell(node --version), Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" start), Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" start --port *), Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" stop), Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" status), Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" open), Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" check), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" start), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" start --port *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" stop), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" status), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" open), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" check)
---

# Onecarat Agent Office

Onecarat Agent Office is a **companion**. It shows what Claude Code is doing. Its chat panel can host the user's own interactive `claude` in a built-in terminal, where the **user** types and answers permission prompts. Office itself never answers permission prompts, never calls a model and never reads credentials, and it never sends prompts, with one exception: in its Research Lab view, when the user presses "Start research", Office pastes one research command into the Office terminal's input box; sending it (Enter) is the user's. Events and terminal output live in memory only; Research Lab results are files Claude Code writes in the working folder (`research/`).

The requested action is: `$ARGUMENTS` (default to `start` when empty).

## 1. Check Node.js first

Run exactly:

```
node --version
```

- If the command is not found, or the major version is below 18: **stop here.** Tell the user, in their language, that Office needs Node.js 18 or newer (the LTS from https://nodejs.org/ is fine), and that on Windows it can be installed with `winget install OpenJS.NodeJS.LTS`. Do **not** install it yourself unless the user explicitly asks. After installing, Claude Code (and the Desktop app) must be restarted so the new `node` is on PATH.
- Otherwise continue.

## 2. Run the launcher

Run exactly one of these (quote the path as shown):

| Action | Command |
|---|---|
| start (also opens the browser) | `node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" start` |
| stop | `node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" stop` |
| status | `node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" status` |
| open the page again (with its access key) | `node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" open` |
| environment check | `node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" check` |

Do not run any other commands for this skill, do not add other options (the launcher accepts only `--port N`, `--cwd DIR`, `--no-terminal`, `--no-open` and refuses anything else), and do not edit any settings file.

## 3. Tell the user

After `start`, say the browser was opened at the URL it printed (normally http://127.0.0.1:47821/). The page gets a per-launch access key from the launcher, so if the user opens that URL by hand they will see "no access key": tell them to ask for `open` instead. Never try to find, print or pass the key yourself. Then explain briefly:

- The chat panel's **Terminal** tab can start Claude Code in the folder shown (the folder this session runs in). Requests and permission answers are typed there by the user. If the launcher printed that the terminal is unavailable, Office is read-only on this computer and Claude Code is used in a normal terminal as before.
- Keep using Claude Code as usual — terminal, IDE or Desktop app. Office shows the session that is most active; other sessions can be picked from the Sessions button.
- Figures appear only for subagents Claude Code really starts. Success/failure is an **estimate** from events. The high-five is a visual effect.
- Permission prompts are always answered by the user in Claude Code (the built-in terminal *is* Claude Code), never by Office.
- Closing the browser tab does not stop Office; use "stop". When Claude Code in the built-in terminal ends (/exit or its Stop button), Office stops by itself a few seconds later and the page keeps the goodbye scene; sessions in other terminals do not stop it. Stopping discards events and terminal output, and also ends a Claude Code running in the built-in terminal.

If `start` reports an error, show it to the user and suggest `node "${CLAUDE_PLUGIN_ROOT}/dist/office.mjs" check`. If the port is in use, `start --port 47822` uses another port.
