# onecarat-agent-office (Claude Code plugin)

Watch Claude Code's main agent and the subagents it really starts work in a small office in your browser. Local only (127.0.0.1); events and terminal output are kept in memory only; it never calls a model and never reads credentials. The chat panel can host your own interactive `claude` in a built-in terminal (you type; Office never types for you). Requires Node.js 18+. Start it with `/onecarat-agent-office:office start`.

Contents: `hooks/hooks.json` (async command hooks -> `scripts/forward.mjs`), `skills/office/SKILL.md` (start/stop/status), `dist/` (bundled bridge, launcher and UI, generated from the repository's `packages/` by `npm run build:plugin`). See the repository README for details.
