# onecarat-agent-office (Claude Code plugin)

Watch Claude Code's main agent and the subagents it really starts work in a small office in your browser. Local only (127.0.0.1), read-only, events kept in memory only, and it never calls a model or reads credentials. Requires Node.js 18+. Start it with `/onecarat-agent-office:office start`.

Contents: `hooks/hooks.json` (async command hooks -> `scripts/forward.mjs`), `skills/office/SKILL.md` (start/stop/status), `dist/` (bundled bridge, launcher and UI, generated from the repository's `packages/` by `npm run build:plugin`). See the repository README for details.
