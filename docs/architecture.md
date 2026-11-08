# Architecture — Onecarat Agent Office CC

```
Claude Code session (terminal / IDE / Desktop app)
  └─ official hooks (plugin hooks/hooks.json: command, exec form, async)
       └─ plugin/.../scripts/forward.mjs      pick + clip fields, POST /hook with token; silent exit 0
            └─ packages/event-bridge          127.0.0.1 only
                 ├─ receiver.ts               auth, parse, normalize (adapter)  ← receiving
                 ├─ store.ts                  reorder buffer (300 ms) + in-memory ring buffer  ← aggregation
                 ├─ broadcaster.ts            SSE snapshot + live batches (token required)  ← delivery
                 └─ terminal.ts               built-in terminal: `claude` in node-pty (optional), WebSocket /pty
                      └─ packages/office-ui   React; reduceOffice() per session; xterm.js chat terminal; demo player isolated
```

| Package | Role |
|---|---|
| `packages/domain` | Tool-agnostic model: `OfficeEvent`, `SessionState`, `AgentState`, `Progress` (`measured / estimated / unavailable`), pure reducer, expression rules (face/pose/bubble). |
| `packages/adapter-claude-code` | Claude Code hook input → `OfficeEvent[]`. Activity classification, prompt-injection detection (`<agent-message>`, `<task-notification>`), display masking. |
| `packages/event-bridge` | Local HTTP server: hook intake, aggregation, SSE, static UI, built-in terminal (`terminal.ts`, node-pty loaded from `dist/vendor`, read-only without it). One per-launch token guards all of it. Memory only. |
| `packages/office-ui` | Office / Chat (Terminal tab = xterm.js, History tab = hook-derived chat) / Console. Live feed (SSE via fetch, with the key) or demo replay (same adapter and reducer, `source:'demo'`). |
| `packages/launcher` | `check / start / stop / status / open`. Bundled to `dist/office.mjs`. |
| `plugin/onecarat-agent-office` | What users install: manifest, hooks, skill, forwarder, `dist/` (generated) and `dist/vendor/node-pty` (upstream files, hash-checked). |
| `examples/demo-events` | Scripted demo, written in raw hook-input shape. |

## Package details

### domain (no dependencies)
- `AgentStatus`: created / idle / delegating / working / waiting_permission / blocked / completed / failed / unknown.
- `Outcome` is always an **estimate** (success_estimated / failure_estimated / unknown), because Claude Code sends no success flag.
- `Progress` is measured / estimated / unavailable. Progress is never made up.
- `reduceOffice(state, ev)` is pure. Rule: invent neither agents nor progress.
  - An unknown agentId becomes a subagent joined mid-session.
  - A `SubagentStop` with no seen start (internal agents: prompt suggestions, `/btw`) is ignored.
  - `subagent.started` is matched to a request by subagent type, then confirmed by `subagent.linked` (tool_use_id).
  - "Report received" is set by the child's `PostToolUse(SubagentHandback)`, an injected `agent-message` / `task-notification`, or the parent's `PostToolUse(Agent)` for a synchronous agent.
  - A late `tool.started` for a finished tool is kept as "(late)" evidence only and does not bring the agent back to working.
  - The session's permission mode is taken from the **main agent's** hook `permission_mode` (display only; Office never sets it).
  - Limits: evidence 300, chat 200, finishedTools 200.
- `expressionOf()`: a failure gets a worried face and no celebration. A permission wait is only a warning bubble (Office never answers). Celebration only for success_estimated **and** acknowledged.

### adapter-claude-code
- `normalizeHook()`: 11 hook events → `OfficeEvent[]` (checked on Claude Code 2.1.319, see [event-support-matrix.md](event-support-matrix.md)).
- `classifyTool()`: Read-like → reading, Edit-like → editing, Bash/PowerShell → executing (testing for test commands), Web → researching, SubagentHandback/SendMessage → reporting.
- `classifyPrompt()`: tells injected turns (agent-message, task-notification, system-reminder…) from user prompts and extracts the sender.
- `mask.ts`: replaces secrets with `***` (key assignments, Bearer, credentials in URLs, sk-/ghp_/xox/AKIA prefixes, 32+ mixed alphanumerics). Paths show their last two segments; `.env`, `*.pem`, `id_rsa` show as "(sensitive file)".

### event-bridge
- Listens on 127.0.0.1 only, port 47821 (`--port` or `ONECARAT_OFFICE_PORT`). Exits 3 if already running.
- A new key per launch (24 random bytes), never printed. Stored in the runtime file `bridge.json` (Windows: `%LOCALAPPDATA%onecarat-agent-office`, mode 0600, written to a temp file and renamed).
- `POST /hook` refuses browser requests (403), a missing key, non-JSON (415) and bodies over 512 KB (413). It answers 200 first, then processes, through a 300 ms ReorderBuffer ordered by hook start time (`x-office-hook-time`, used if within 60 s of the receive time).
- `/events` (SSE: snapshot, then batches, ping every 15 s), `/api/clear` and `/api/shutdown` need the key. `/api/health` without the key says only whether this is Office.
- WebSocket `/pty`: Host, exact Origin and the key are checked before the upgrade. The key arrives as subprotocol `office-token.<token>`; the server answers only `office.v1`.
- `terminal.ts`: the bridge fixes the command (`claude --session-id <uuid>`; nothing else, no permission mode). Scrollback in memory only, up to 512 KB. Output is never parsed. Without node-pty, read-only.
- `child-env.ts`: removes the calling session's markers and private channels (`CLAUDECODE`, `CLAUDE_CODE_SESSION*`, `CLAUDE_CODE_MESSAGING_*`, `CLAUDE_PLUGIN_*` …). Keeps the user's configuration (`CLAUDE_CONFIG_DIR`, `ANTHROPIC_*`, provider settings).

### launcher
- No run-time dependencies. Calls no model and touches no credentials.
- `start`: if running, only opens the page. Otherwise starts the bridge detached (with `--cwd` = the launcher's folder) and waits for its pid and health (40 × 150 ms).
- The key goes only in the URL fragment `#t=`. On Windows the browser is opened with `rundll32 url.dll,FileProtocolHandler` because `explorer.exe` drops the fragment.
- `stop`: calls `/api/shutdown`; kills the process if it does not exit and removes the runtime file. `check`: Node >= 18 and a node-pty prebuild for this OS/CPU.

### office-ui
- Top bar (live / reconnecting / no access key / offline), rail (Office / Sessions / Settings), Stage (1600×480 SVG office), ChatPanel (Terminal / History), ConsolePanel (state, estimated outcome, last 80 evidence lines).
- Which session is shown: pinned > the built-in terminal's session > the most recently active one.
- The terminal bar shows the folder and the permission mode reported by that session's hooks.
- `live/token.ts`: reads `#t=`, removes it from the URL at once, keeps it in sessionStorage. `useLiveFeed`: reads SSE with fetch (EventSource cannot send the key header). 401 → "no access key"; reconnects every 2 s.
- `useDemoPlayer`: replays `examples/demo-events/office-demo.json` through the same normalizeHook + reduceOffice as live.
- English/Japanese, theme (system/light/dark), motion (system/reduce/full), saved in localStorage. Keyboard operable, aria labels.

### plugin
- `hooks.json`: 11 events call `node ${CLAUDE_PLUGIN_ROOT}/scripts/forward.mjs` (async, timeout 5).
- `forward.mjs`: always exits 0 with no output (forced exit at 3 s, request timeout 1.5 s). No runtime file → no connection.
- `forward-lib.mjs`: allow-listed, clipped fields only. Never file contents, transcript path or tool output (except the Agent tool's agentId / isAsync / status).
- Skill `office [start|stop|status|open|check]`: only explains how to install Node (never installs it), never shows the key, leaves permission answers to the user.

## Key decisions (measured on real Claude Code; see [event-support-matrix.md](event-support-matrix.md))
- **Event source = command hooks + node forwarder (async).** HTTP hooks produced a hook error on every tool call while Office was down, and `SessionStart` supports only command/mcp_tool hooks. Mods (in-process) are early access; they are an optional extra at most.
- **Subagent identity** = `agent_id` on hook input. Request ↔ agent link = the parent's `PostToolUse(Agent).tool_response.agentId`. A `SubagentStop` without a seen `SubagentStart` is an internal agent and is ignored.
- **"Manager received the report"** has three accepted signals: the child's `PostToolUse(SubagentHandback)`, `UserPromptSubmit` starting with `<agent-message from="id">`, or `<task-notification><task-id>id`.
- **Outcome is estimated**: reported → success; unreported after a failing tool → failure; else unknown.
- **Chat input = built-in terminal (B1).** Only an embedded real `claude` lets the user ask, answer prompts and watch in one window; a mod (B2) can only fill Claude Code's own input box in another window. node-pty is N-API, so one upstream prebuild per OS/CPU is shipped instead of building or installing at first run. The terminal starts in the launcher's folder (the session that asked for Office) unless the user picks another. Its session is started with `--session-id`, so the office view follows it from its hooks; the terminal output itself is never parsed.
- **Async ordering**: forwarder stamps hook start time; bridge reorders in a 300 ms window; the reducer ignores a late `PreToolUse` for an already finished `tool_use_id`.

## Codex (future, Phase 5)
`domain` has no Claude-specific fields. A Codex adapter would map its own events to `OfficeEvent`. There is no stub or invented API until Codex's interfaces and terms are checked.

## Roadmap notes
- Chat input: built-in terminal (B1). The mod route (B2, `$.prompt.fill`, verified on real Claude Code) is an optional extra only.
- Linux built-in terminal: there is no upstream node-pty prebuild. Options: build at first run (needs a compiler and npm) or the Phase 4 single executable.
- Phase 4: **Node-free single executable** (Node SEA or similar), so users without Node.js can run Office (it would also carry node-pty), plus a native window.
- Repository layout: development happens in a private repository, and an allow-listed export publishes this public one. If outside issues and pull requests become common, flip it: develop here in public and move only internal documents to a separate private repository.
