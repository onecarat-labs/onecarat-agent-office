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
3. Built-in terminal in a manual permission mode: an edit request waits for permission; answer with arrows / Enter / Esc in the terminal. Japanese input is not garbled or doubled.
4. The permission-mode label matches the terminal footer after the next request.
5. A request that uses no subagent shows no extra figures.
6. Desktop app session (Manual mode) with a Write → amber waiting state while the prompt is open in Desktop; approve there.
7. Two sessions at once → listed separately, no mixing.
8. Stop Office → keep using Claude Code → no hook errors; no runtime file left; no embedded `claude` process left.
9. Disable / uninstall the plugin → hooks gone; `~/.claude/settings.json` has no leftover Office hooks.
10. Light/dark, 390 px width, keyboard (Tab / ←→ / Enter), reduced motion.

## Not yet verified
- macOS (the prebuild is shipped but untested) and Linux (read-only by design today).
- Interrupts (`is_interrupt`) and `SessionEnd` on a normal `/exit`.
- Claude Code versions older than 2.1.319.
