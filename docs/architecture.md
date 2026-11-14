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
- `terminal.ts`: the bridge fixes the command: `claude --session-id <uuid>`, `claude --continue` or `claude --resume` (the page names one of the three start modes; nothing else, no permission mode). Each start gets a run id in `ONECARAT_OFFICE_TERMINAL`; the forwarder sends it as `x-office-terminal`, and a `SessionStart` carrying the current run id sets the session the view follows (`adoptSession`), so a continued or picked conversation, and a switch inside the terminal (`/resume`, `/clear`), are followed. A continue/resume start that ends before any conversation opened does not stop Office. `claude-path.ts` resolves `claude` to an absolute path from PATH once (never from the working folder: cmd.exe looks there first). Scrollback in memory only, up to 512 KB. Output is never parsed. Without node-pty or without `claude`, read-only.
- `child-env.ts`: removes the calling session's markers and private channels (`CLAUDECODE`, `CLAUDE_CODE_SESSION*`, `CLAUDE_CODE_MESSAGING_*`, `CLAUDE_PLUGIN_*` …). Keeps the user's configuration (`CLAUDE_CONFIG_DIR`, `ANTHROPIC_*`, provider settings).

### launcher
- No run-time dependencies. Calls no model and touches no credentials.
- `args.ts`: options are an allow-list (`--port`, `--cwd`, `--no-terminal`, `--no-open`); nothing else is passed to the bridge, because the plugin skill pre-approves the launcher command.
- `start`: if running, only opens the page. Otherwise starts the bridge detached (with `--cwd` = the launcher's folder) and waits for its pid and health (40 × 150 ms).
- The key goes only in the URL fragment `#t=`. On Windows the browser is opened with `rundll32 url.dll,FileProtocolHandler` because `explorer.exe` drops the fragment.
- `stop`: calls `/api/shutdown`; kills the process if it does not exit and removes the runtime file. `check`: Node >= 18, a node-pty prebuild for this OS/CPU, and where the installed Claude Code stands for the Research Lab. For that it runs `claude --version` (absolute path, no shell, timeout; `claude-version.ts`): the only place where Office's own code runs `claude`.

### office-ui
- Top bar (live / reconnecting / no access key / offline), rail (Office / Sessions / Settings), Stage (1600×480 SVG office), ChatPanel (Terminal / History), ConsolePanel (nobody selected: counts, agent list and the latest 80 evidence lines of everyone; one agent: task, state, estimated outcome and its last 80 lines).
- The office picture carries no standing text panels. A status chip over its top right corner (counts; a permission wait is always on it) opens the task list. The label above a figure is a short stage name with a pulsing dot while busy, never a bar (no progress is known); the full wording is the tooltip and the Console. Labels that need the user (permission wait, interrupted, failed, retrying) keep a colored outline.
- Which session is shown: pinned > the built-in terminal's session > the most recently active one.
- The terminal bar shows the folder (last two parts; full path in the tooltip), the permission mode reported by that session's hooks, and start / stop. Its "more actions" menu has two items, each opening a native `<dialog>` (modal, Escape closes, focus returns to the menu button): the working folder (how to start: new / continue / pick a past session; where: current folder, another session's folder or a typed one) and the terminal text size. A start from the dialog goes through the same confirmation as before when Claude Code is running; declining keeps both the session and the dialog.
- `live/token.ts`: reads `#t=`, removes it from the URL at once, keeps it in sessionStorage. `useLiveFeed`: reads SSE with fetch (EventSource cannot send the key header). 401 → "no access key"; reconnects every 2 s.
- `useDemoPlayer`: replays `examples/demo-events/office-demo.json` through the same normalizeHook + reduceOffice as live.
- English/Japanese, theme (system/light/dark), motion (system/reduce/full), text size (80–160%; not the office picture), the built-in terminal's own text size (80–200%; also in the terminal's "more actions" menu and with Ctrl+wheel over the terminal) and the sizes of the three areas (draggable borders), saved in localStorage. Keyboard operable, aria labels.

### plugin
- `hooks.json`: 11 events call `node ${CLAUDE_PLUGIN_ROOT}/scripts/forward.mjs` (async, timeout 5).
- `forward.mjs`: always exits 0 with no output (forced exit at 3 s, request timeout 1.5 s). No runtime file → no connection.
- `forward-lib.mjs`: allow-listed, clipped fields only. Never file contents, transcript path or tool output (except the Agent tool's agentId / isAsync / status, and on `Stop` the id / status / agent type of the running background tasks).
- Skill `office [start|stop|status|open|check]`: only explains how to install Node (never installs it), never shows the key, leaves permission answers to the user.
- Skill `research` and the subagent definition `researcher`: see Research Lab below. Neither pre-approves a tool or sets a permission; the researcher has no Agent tool.

### Research Lab
A second view of the same Claude Code session ("‹" / "›"; switching changes only what is shown). The manager and its researchers at the top, a Findings Board of cards. No second terminal, no second session.

```
Start research (theme, count, researchers)   POST /api/research/start
  └─ ResearchController (research.ts)        pastes ONE command line into the Office terminal; never Enter
the user presses Enter
  └─ skills/research/SKILL.md                the manager's procedure (shipped with the plugin)
       └─ agents/researcher.md               researchers, started in the background
            └─ research/<id>/*.json          written by Claude Code (request, results, reviews, summary)
                 └─ research-result.ts       read + schema check (read-only) → cards → GET /api/research (polled)
```

- `research.ts`: builds everything from hook events and from the files, never from who pasted: a research the user typed themselves (any terminal, IDE, Desktop app) is shown the same way. A researcher is counted only for a `SubagentStart` of the type `onecarat-agent-office:researcher`; it is "completed" only on Claude Code's own completion notice, or after its report when the manager's next `Stop` no longer lists it as running. A research is "completed" only when `summary.json` exists; otherwise "end not confirmed".
- `research-result.ts`: the file formats and their validation. Results are read from `<cwd of the session that ran the research>/research/<id>/` (`researchRoot()` is the one place that decides it); after a restart only the Office folder and the built-in terminal's folder are read back.
- `terminal.ts` `pasteLine()`: the only path through which Office writes to a terminal by itself. There is no code that sends Enter.
- Permission waits (both views): each agent keeps its open requests with their arrival time. A refused prompt sends no hook, so the page shows how long a wait has been there and lets the user hide it (`POST /api/waits/dismiss` → a `wait.dismissed` event). Hiding is display only: a request stays open until a hook closes it, and until then nothing is pasted and the view does not go back by itself.
- The page switches the view by itself at most twice per research (to the Office view after the paste, back to the Research Lab once the researchers appeared), never while something waits for approval, and never after the user switched by hand.
- State lives in the bridge, so it survives view switches and page reloads.
- The rules it keeps, and the two exceptions it makes, are in [security.md](security.md) section 1a.
## Key decisions (measured on real Claude Code; see [event-support-matrix.md](event-support-matrix.md))
- **Event source = command hooks + node forwarder (async).** HTTP hooks produced a hook error on every tool call while Office was down, and `SessionStart` supports only command/mcp_tool hooks. Mods (in-process) are early access; they are an optional extra at most.
- **Subagent identity** = `agent_id` on hook input. Request ↔ agent link = the parent's `PostToolUse(Agent).tool_response.agentId`. A `SubagentStop` without a seen `SubagentStart` is an internal agent and is ignored.
- **"Manager received the report"** has three accepted signals: the child's `PostToolUse(SubagentHandback)`, `UserPromptSubmit` starting with `<agent-message from="id">`, or `<task-notification><task-id>id`.
- **Outcome is estimated**: reported → success; unreported after a failing tool → failure; else unknown.
- **Chat input = built-in terminal (B1).** Only an embedded real `claude` lets the user ask, answer prompts and watch in one window; a mod (B2) can only fill Claude Code's own input box in another window. node-pty is N-API, so one upstream prebuild per OS/CPU is shipped instead of building or installing at first run. The terminal starts in the launcher's folder (the session that asked for Office) unless the user picks another. A new session is started with `--session-id`, and a continued or picked one is identified by its own `SessionStart` hook (run marker), so the office view follows it from its hooks; the terminal output itself is never parsed.
- **Async ordering**: forwarder stamps hook start time; bridge reorders in a 300 ms window; the reducer ignores a late `PreToolUse` for an already finished `tool_use_id`.

## Codex (future, Phase 5)
`domain` has no Claude-specific fields. A Codex adapter would map its own events to `OfficeEvent`. There is no stub or invented API until Codex's interfaces and terms are checked.

## Roadmap notes
- Chat input: built-in terminal (B1). The mod route (B2, `$.prompt.fill`, verified on real Claude Code) is an optional extra only.
- Linux built-in terminal: there is no upstream node-pty prebuild. Options: build at first run (needs a compiler and npm) or the Phase 4 single executable.
- Phase 4: **Node-free single executable** (Node SEA or similar), so users without Node.js can run Office (it would also carry node-pty), plus a native window.
- Repository layout: development happens in a private repository, and an allow-listed export publishes this public one. If outside issues and pull requests become common, flip it: develop here in public and move only internal documents to a separate private repository.
