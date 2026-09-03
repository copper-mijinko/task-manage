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
- If Claude Code has not loaded that server, restart or re-approve the project
  MCP configuration, and report GUI verification as unavailable until it is
  active. Do not substitute a normal browser or a direct visit to the Vite URL.
