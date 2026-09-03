@AGENTS.md

# Claude Code integration

This file is a thin wrapper. The shared agent policy — including the GUI /
runtime verification boundary, the required interactive Electron workflow, and
the mandatory `GUI verification:` status line in every final response — lives in
[AGENTS.md](AGENTS.md), which is imported above. Read it before acting, and
treat it as the source of truth; keep only Claude Code specific notes here.

Claude Code specific:

- Use the project-local `.mcp.json` entry named `task-manage-ui`. It connects
  Playwright MCP to the Agent UI Electron CDP endpoint (`http://127.0.0.1:9222`);
  it is not a normal browser target.
- Start the Agent UI (`npm run dev:agent`) and confirm
  `npm run verify:agent-ui -- --wait=30000` before expecting that server to work.
  Claude Code connects its MCP servers at session start, so a session that began
  while the CDP port was closed keeps showing `task-manage-ui` as failed until
  the project MCP configuration is re-approved or the session is restarted.
- If it still cannot be used, follow the fallback in AGENTS.md (Playwright
  attached to the same Electron CDP endpoint) and say so explicitly. Never
  substitute a normal browser or a direct visit to the Vite URL.
