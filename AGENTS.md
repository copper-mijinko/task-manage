# Task Manage: agent GUI verification

Apply this workflow whenever a task changes or evaluates the GUI. It is the repository's standard interactive verification path for Codex and Claude.

## Start and verify the shared GUI

1. Use Node.js 22.12 or newer within major version 22 and install dependencies with `npm ci` when needed.
2. From the repository root, start `npm run dev:web` in a persistent terminal. Keep that process running while editing.
3. Wait until the real Electron renderer is available:

   ```text
   npm run verify:agent-ui -- --wait=30000
   ```

4. Connect with the Playwright MCP server named `task_manage_ui` in Codex or `task-manage-ui` in Claude. It attaches to the running Electron app through CDP at `http://127.0.0.1:9222`.
5. Inspect the accessibility/DOM snapshot first, perform the relevant clicks and keyboard input, then inspect the resulting state and console messages. Take screenshots when layout, spacing, color, clipping, or alignment needs visual judgment.
6. After each source edit, let Vite HMR update the same Electron window and repeat the focused interaction. The human can watch that window throughout the work.

Do not treat a normal browser tab opened directly at `http://localhost:5173` as equivalent verification. It does not have Electron's preload bridge and cannot exercise the real IPC-backed behavior. Automated Playwright E2E remains a separate regression check; it does not replace this interactive workflow.

If the MCP server is unavailable in a new chat, do not guess about the UI. Follow `docs/agent-ui-development.md` to install the repository-local MCP configuration, restart the agent client, and run the readiness command again.

## Safety and CI boundary

- Agent UI mode is development-only and binds CDP to loopback.
- Never enable it in packaged builds or automated E2E.
- Keep CI on the existing build, unit/component, and Playwright E2E commands. Do not add `dev:web` to GitHub Actions.
