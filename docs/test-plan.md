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
- **Research Lab / open folder**
  - one command line is pasted once, as a bracketed paste, with no Enter and no control character; nothing is pasted while Claude Code is not running in the Office terminal, before that session's first hook, or while a `PermissionRequest` is open there (the command is then only returned for copying); a pasted, unsent command blocks a second paste; dismissing writes nothing
  - researchers are counted only for the researcher type; "completed" only on the completion notice, or after a report once the manager's `Stop` no longer lists the agent; a research is "completed" only with `summary.json`, otherwise "end not confirmed", and new evidence brings it back
  - a research the user typed in any session is followed; only `<cwd of that session>/research/<id>/<file>.json` is read (local absolute path, exact match, no links)
  - permission waits: kept per agent with their time; two queued requests; a late `Notification(permission_prompt)` never moves the wait to the manager; a refusal (no hook) ends with the agent's next call; "hide this wait" changes the display only, writes nothing to the terminal and records neither allowed nor refused; a hidden wait still holds back the paste (`wait-unknown`) and the automatic return until a hook closes it
  - `check`: `claude` is run only as `<absolute path> --version`, without a shell and with a timeout; only `N.N.N` is read; the three stages (does not work / untested / checked)
  - the page gets a file id and a display name, never a path; `/api/reveal` takes the id only; only a regular file is selected, anything else shows the parent folder
  - result, review and summary files: schema check, wrong research id, broken JSON, size limit, sub-folders and links not followed; restore from disk after a restart
  - `/api/research*` and `/api/waits/dismiss` need the token and refuse cross-site requests; `/pty/research` no longer exists; `/api/reveal` opens only a file the bridge recorded as written
  - the shipped skill and researcher definition loosen no permission and give the researcher no Agent tool
  - scripts that act on the running Office (`check-terminal.mjs`, `capture-live.mjs`) do nothing without `ONECARAT_OFFICE_LIVE=1`
  - files of a request are listed only when the request wrote five or fewer
  - screen check with a fake terminal and test data (the two automatic view changes, the return held back by a wait, the wait rows and "hide", the people strip): `node tests/screenshots/check-research.mjs <outDir>`
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

15. Research Lab with real Claude Code (the Office terminal's Claude Code must have a plugin version that ships the research skill):
    - "›" → theme, 3 findings, 2 researchers → "Start research". The command appears in the input box of the Office terminal, **not sent**, and the page shows the Office view with "press Enter in the terminal below".
    - Press Enter. The manager writes `request.json` and starts the researchers; they appear at desks named "Researcher"; the page goes back to the Research Lab by itself.
    - Answer the permission prompts yourself (in the "ask each time" mode expect about 5 to 10 per finding). While one is open, the Research Lab shows who waits and since when, and never moves to the Office view by itself.
    - Cards appear one by one with their writer (R1, R2) and the manager's check; the count and any shortfall are right; a card opens its detail. The research is "done" only after `summary.json`.
    - Refuse a prompt of the manager (No): the wait stays, with its age; "Hide this wait" removes it and nothing is sent to the terminal. Press "Start research" right after: nothing is pasted, the command is shown for copying with the reason; after the next prompt in that terminal, pasting works again.
    - Start a research while a prompt is open at the moment of return: the page stays in the Office view and offers "See the Research Lab".
    - Type the command yourself in another terminal: the Research Lab shows that research too. Switching views, and a reload, keep the board; after restarting Office the research is restored.
    - With a Claude Code that has not loaded the skill: "Unknown command" in the terminal; the page keeps "Press Enter" until "Drop it".
16. Console → "Files created" after asking for one document: the row opens its folder with the file selected.

## Not yet verified
- **Research Lab, end to end from the button** (item 15, first three steps): pasting by Office, Enter by the user, and the automatic return have only been checked with the fake terminal. Checked on the real machine by the user (Claude Code 2.1.323 to 2.1.325, Windows 11): the skill and the researchers, the files and cards, the completion rules, the paste itself, refusing a researcher's prompt, and that a refused prompt of the manager sends no hook.
- Research Lab on Claude Code older than 2.1.323. The README says 2.1.198 or newer, from the public changelog (`background_tasks` on `Stop`: 2.1.145; subagents in the background by default: 2.1.198); the versions that introduced plugin-shipped subagents, `background: true` and `agent_id` on a subagent's hooks could not be confirmed there.
- macOS (the prebuild is shipped but untested) and Linux (read-only by design today).
- Interrupts (`is_interrupt`) and `SessionEnd` on a normal `/exit`.
- Claude Code versions older than 2.1.319.
