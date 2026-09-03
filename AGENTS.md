# Task Manage agent GUI verification

This file is the shared interactive GUI/runtime verification policy for Codex Desktop and Claude Code. Apply it in every new agent session in this repository.

## Verification boundary

Use the repository's real Electron `BrowserWindow` for any change that can affect user-visible behavior or the Electron runtime. This includes Svelte UI, preload, Electron IPC, workspace load/save, task detail windows, memos, attachments, images, startup, window creation, caches, filesystem interaction, error handling, and user-visible performance or responsiveness.

Pure documentation, comments, or other changes that cannot affect runtime behavior may skip Electron verification. Explain that decision in the final response.

For task-manage GUI/runtime verification, never use Codex Browser, a Browser skill, Claude's normal browser controls, Chrome, a normal browser tab, or a direct visit to `http://localhost:5173`. Do not use any of them as a fallback. A normal browser has no Electron preload bridge or IPC and is not evidence that the application works. The real Electron renderer may itself load the Vite URL; the required distinction is that Playwright connects to that renderer through Electron CDP.

## Required interactive workflow

Order matters: **start the Agent UI first, then connect the Playwright MCP.** Both MCP clients connect at session start, and a client that starts while `127.0.0.1:9222` is not listening reports the server as failed or closed for the rest of the session.

1. Read this file (and `CLAUDE.md` in Claude Code) before acting.
2. Make sure repository dependencies are installed (`npm ci` when `node_modules/` is missing). The MCP server is `node_modules/@playwright/mcp/cli.js`; without it the MCP server process exits immediately and the session shows it as unavailable.
3. Reuse an existing healthy Agent UI process when possible. Otherwise, from the repository root, start the canonical persistent process with `npm run dev:agent`. `npm run dev:web` is a compatibility alias with the same implementation and may be reused when it is already running.
   - `dev:agent` handles headless and root environments by itself: it starts an `Xvfb` display when `$DISPLAY` is unset, adds `--no-sandbox` when running as root (Electron refuses to start as root without it), and skips launching a second Electron when `127.0.0.1:9222` is already in use. Do not hand-roll a different launcher when this one works.
4. Confirm readiness with `npm run verify:agent-ui -- --wait=30000`. Use `--json` when machine-readable diagnostics are useful. Do not continue until it reports `ready: true` for vite, cdp, electron, and preload.
5. Connect through the repository Playwright MCP to Electron CDP at `http://127.0.0.1:9222`:
   - Codex server: `task_manage_ui` (see `.codex/config.toml.example`)
   - Claude server: `task-manage-ui` (see `.mcp.json`)

   If the MCP server is listed as failed or closed, this is almost always ordering or missing dependencies. Fix the cause from steps 2-4, then reconnect or re-approve the MCP configuration (Codex: reload MCP servers; Claude Code: re-approve the project MCP configuration or restart the session). Retry before concluding that verification is unavailable.

6. Take an accessibility/DOM snapshot and confirm that the target is task-manage.
7. Perform the relevant user operation.
8. Take another snapshot and inspect console messages for new significant errors.
9. Use a screenshot only when judging layout, color, position, clipping, overlap, or another visual property that snapshots cannot establish.
10. After a source edit, use Vite HMR when sufficient; restart the Agent UI process when preload, main-process, startup, or window-creation behavior requires it. Repeat the same focused operation. Main-process files (`electron/**`) never hot-reload — restart the Agent UI before trusting any result that depends on them.

Automated Playwright E2E is regression automation, not a substitute for this interactive Agent GUI workflow.

### Fallback: Playwright directly against Electron CDP

The MCP path above is the preferred one; take it whenever it can be made to work. When the MCP client itself cannot be connected in the current session and steps 2-5 do not recover it, driving the same real Electron renderer with a local Playwright script over the same endpoint is an acceptable fallback:

```js
// scratch script, not committed
import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages()[0];
```

The requirement it satisfies is the same one the MCP satisfies: Playwright is attached to the repository's real Electron renderer, with the preload bridge and IPC live. It is still forbidden to substitute a normal browser or a direct visit to the Vite URL. When this fallback is used, report `GUI verification: performed` and state plainly that the connection was a direct Playwright CDP session rather than the MCP, and why.

## Unavailable verification

If Electron cannot start, readiness verification fails, CDP is unavailable, the preload bridge is missing, or neither the MCP nor a direct Playwright CDP session can reach the renderer:

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
- The `--no-sandbox` flag and the `Xvfb` display added by `dev:agent` belong to the Vite dev plugin only (`vite.config.js` + `scripts/agent-ui-launch.mjs`). They must never reach `npm run start` on its own, the packaged build, or CI.
- Keep existing Linux/Xvfb Playwright E2E independent. Do not add the interactive `dev:agent` or `dev:web` process to CI.
