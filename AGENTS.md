# Task Manage agent GUI verification

This file is the shared interactive GUI/runtime verification policy for Codex Desktop and Claude Code. Apply it in every new agent session in this repository.

## Verification boundary

Use the repository's real Electron `BrowserWindow` for any change that can affect user-visible behavior or the Electron runtime. This includes Svelte UI, preload, Electron IPC, workspace load/save, task detail windows, memos, attachments, images, startup, window creation, caches, filesystem interaction, error handling, and user-visible performance or responsiveness.

Pure documentation, comments, or other changes that cannot affect runtime behavior may skip Electron verification. Explain that decision in the final response.

For task-manage GUI/runtime verification, never use Codex Browser, a Browser skill, Claude's normal browser controls, Chrome, a normal browser tab, or a direct visit to `http://localhost:5173`. Do not use any of them as a fallback. A normal browser has no Electron preload bridge or IPC and is not evidence that the application works. The real Electron renderer may itself load the Vite URL; the required distinction is that Playwright connects to that renderer through Electron CDP.

## Required interactive workflow

1. Read this file (and `CLAUDE.md` in Claude Code) before acting.
2. Reuse an existing healthy Agent UI process when possible. Otherwise, from the repository root, start the canonical persistent process with `npm run dev:agent`. `npm run dev:web` is a compatibility alias with the same implementation and may be reused when it is already running.
3. Confirm readiness with `npm run verify:agent-ui -- --wait=30000`. Use `--json` when machine-readable diagnostics are useful.
4. Connect only through the repository Playwright MCP to Electron CDP at `http://127.0.0.1:9222`:
   - Codex server: `task_manage_ui`
   - Claude server: `task-manage-ui`

5. Take an accessibility/DOM snapshot and confirm that the target is task-manage.
6. Perform the relevant user operation.
7. Take another snapshot and inspect console messages for new significant errors.
8. Use a screenshot only when judging layout, color, position, clipping, overlap, or another visual property that snapshots cannot establish.
9. After a source edit, use Vite HMR when sufficient; restart the Agent UI process when preload, main-process, startup, or window-creation behavior requires it. Repeat the same focused operation.

Automated Playwright E2E is regression automation, not a substitute for this interactive Agent GUI workflow.

## Unavailable verification

If Electron cannot start, readiness verification fails, CDP is unavailable, the preload bridge is missing, or the configured Playwright MCP cannot be used:

- Do not open or use a normal browser instead.
- Do not infer GUI state from source code or screenshots from another runtime.
- Report `GUI verification: unavailable` and name the missing condition and relevant diagnostic code/output.
- State the next concrete setup or startup action needed. Do not claim that GUI verification was performed.

## Final response requirement

Every final response must include exactly one of these status lines:

- `GUI verification: performed` — briefly list the real Electron operations and results.
- `GUI verification: skipped` — state why the changes cannot affect GUI/runtime behavior.
- `GUI verification: unavailable` — state which Electron, CDP, preload, or MCP condition was unavailable.

## Safety and CI boundary

- Agent CDP is development-only, binds to loopback `127.0.0.1`, and must never be exposed to an external network.
- Keep Agent CDP disabled for packaged/production builds, normal application use, and runs with `PLAYWRIGHT_TEST=true`.
- Do not weaken Electron security hardening or move Playwright MCP into production dependencies.
- Keep existing Linux/Xvfb Playwright E2E independent. Do not add the interactive `dev:agent` or `dev:web` process to CI.
