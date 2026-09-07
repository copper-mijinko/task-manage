# Node Graph Verification

This record covers the workspace node graph implementation described in
[node-graph-design.md](node-graph-design.md). All automated fixtures used isolated temporary
workspaces; no user workspace was used as test data.

## Verified behavior

### Persistence and command model

- Legacy project Markdown imports into the versioned canonical graph without changing source files.
- Commands serialize by canonical workspace path and reject stale revisions.
- Failed persistence leaves graph state and undo history unchanged.
- Focused tests cover root protection and reachability, ordered parent edges, move, detach, node-only delete, three copy modes, and undo/redo.
- Imported and copied assets remain in canonical storage after source-node deletion and undo.

### Runtime views

- Graph, Tree, Finder, and Gantt read canonical graph state.
- A graph-created cycle becomes a terminal cycle reference in Tree and Finder.
- Tree-origin commands reject a new cycle while unrelated existing cycles remain usable.
- Omitted status and explicit `Undefined` remain distinct across save and restart.
- Tag filters retain matching nodes and ancestor connectors; repeating the active tag clears it.
- The inspector adds and removes tag chips, updates the sidebar index, and persists changes.

## Automated results

Final Windows verification on 2026-09-07 used Node 22.20.0.

| Check | Result |
| --- | --- |
| ESLint (`npm run lint`) | Passed |
| Svelte diagnostics (`npm run check`) | 0 errors, 0 warnings |
| Vitest (`npm test -- --run`) | 70 files; 845 passed, 7 skipped |
| Vite production build | Passed; 2,686 modules transformed |
| Electron Playwright E2E | 18 passed with one worker |

The E2E suite includes a genuine application restart against the same graph snapshot,
occurrence move and detach with two undo operations, cycle creation and cycle-cut
navigation, non-graph cycle rejection, legacy smoke coverage, sidebar tag filtering,
and tag-chip persistence across restart.

## Interactive Electron verification

The Agent UI started before Playwright attached to the real Electron renderer over
loopback CDP at `127.0.0.1:9222`. Readiness reported Vite, CDP, Electron, and preload
as ready. The session verified legacy migration and image rendering; Tree and Finder
cycle terminals; return to the selected graph node; undo/redo; disabled root controls;
selection without a revision change; creation with `Undefined` in Gantt; sidebar tag
filtering and clearing; and tag-chip add, remove, and reload persistence. Filtering
changed the graph from seven nodes to four while retaining ancestor connectors, then
restored all seven. No new page or console errors were observed.

Direct Playwright CDP was used because a callable Playwright MCP server was not exposed
in the verification task. It controlled the real Electron `BrowserWindow` with preload
and IPC active.

## Known build warnings

Vite reports existing config-loader compatibility, runtime-resolved `global.css`, and
large-chunk warnings. They do not fail the build.
