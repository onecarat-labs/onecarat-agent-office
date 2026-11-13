# Test plan — Onecarat Agent Office CC

## Automated (`npm test`, `npm run typecheck`, CI on Windows + Ubuntu)
- **Domain/adapter**
  - demo replay: success, permission wait, estimated failure
  - no subagent without evidence; internal `SubagentStop` is ignored
  - sessions are isolated
  - no celebration on failure or before acknowledgement; progress is never numeric
  - prompt classification, masking, late `PreToolUse`
  - handback / task-notification acknowledgement
  - permission mode is taken from the main agent's hooks only
- **Bridge**
  - rejects a bad token, a wrong Host, browser origins and wrong content types; rejects cross-site UI requests
  - the event stream and control APIs need the token; health reveals nothing without it
  - reordering, forwarder field stripping, runtime-path agreement
  - forwarder E2E: not running, dead port and running all end with exit 0 and no output
- **Terminal**
  - `/pty` refuses a wrong Origin, a missing token and a wrong token, and never echoes the token
  - only the bridge-defined command runs (`claude --session-id <uuid>`, no other flags); session markers are removed from its environment, user configuration is kept
  - "continue" and "pick a past session" run `claude --continue` / `claude --resume` and nothing else; an unknown start mode starts nothing; the session is taken from a `SessionStart` hook carrying the current run marker only (no marker, an old run, other events and late hooks are ignored); ending before a conversation opened does not stop Office
  - scrollback is replayed to a new tab and cleared by "clear history"
  - a missing folder is refused
  - without node-pty, Office stays read-only and the rest keeps working
  - the vendored node-pty loads where an upstream prebuild exists (Windows, macOS)
- **CI**
  - `dist-matches-source`: rebuild plugin `dist/`, require no diff; the build also starts the bundled bridge (smoke test)
  - `vendor-matches-upstream`: `dist/vendor/node-pty` is byte-identical to the published npm tarball (pinned sha512)

## Manual (real Claude Code; Demo mode does not count)
1. Install from the marketplace with the two README commands → "Start Onecarat Agent Office" → the page opens with its key. Opening the URL by hand shows "no access key".
2. Built-in terminal: start Claude Code, ask for something that uses two subagents → two figures, both report, the manager receives them, high-five, all on one screen.
3. Built-in terminal in a manual permission mode: an edit request waits for permission; answer with arrows / Enter / Esc in the terminal. Japanese input is not garbled or doubled. While Claude Code has mouse reporting on, a right click opens no browser menu; Shift+right click does; with mouse reporting off the browser menu opens as before.
4. The permission-mode label matches the terminal footer after the next request.
5. A request that uses no subagent shows no extra figures.
6. Desktop app session (Manual mode) with a Write → amber waiting state while the prompt is open in Desktop; approve there.
7. Two sessions at once → listed separately, no mixing.
8. Stop Office → keep using Claude Code → no hook errors; no runtime file left; no embedded `claude` process left.
9. Disable / uninstall the plugin → hooks gone; `~/.claude/settings.json` has no leftover Office hooks.
10. Light/dark, 390 px width, keyboard (Tab / ←→ / Enter), reduced motion.
11. Settings (gear): menu / list / detail. Office → Display changes theme, motion and language at once and keeps them after a reload. Each Claude Code topic lists its locations with the in-use count; the folder selector and Reload re-read; nothing is editable.
12. Area sizes and text size: drag the border between the office and the lower areas (height) and between the terminal and the console (width); arrow keys on a focused border; double-click resets that border. Settings → Office → Display → Text size (80–160%), Terminal text size (80–200%, the built-in terminal only; also in the terminal's "…" menu and with Ctrl+wheel over the terminal; no A−/A+ in the bar) and Area sizes, each with "Reset to default". All of it is kept after a reload and after Office is restarted. Automated: `node tests/screenshots/check-layout.mjs <outDir>`.
13. Information density: the office shows no task board; the counter at its top right opens the task list (rows follow agents coming and going; a row selects that agent) and shows a permission wait at once. Labels above the figures are short, without a bar; hovering a figure shows the full wording and its task. Console: overview while nobody is selected, one agent after a click on its figure, overview again after a second click. Terminal bar: folder, permission mode, start / stop and the "…" menu with two items and no scrollbar (Change working folder, Terminal text size), each opening its own dialog; Escape, the close button and a click outside close them. While Claude Code runs, starting from the folder dialog asks first, and "Cancel" leaves the session running.
14. Double-click on the empty part of the terminal's or the console's header maximizes that pane; again restores it. A double-click on the tabs, the agent selector or the buttons does not.

## Not yet verified
- macOS (the prebuild is shipped but untested) and Linux (read-only by design today).
- Interrupts (`is_interrupt`) and `SessionEnd` on a normal `/exit`.
- Claude Code versions older than 2.1.319.
