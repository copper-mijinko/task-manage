import agentDebug from "../electron/agent-debug.js";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSupportedNodeVersion,
  parseVerifyOptions,
  waitForAgentUi,
} from "./agent-ui-runtime.mjs";

const { DEFAULT_AGENT_DEBUG_PORT, parseAgentDebugPort } = agentDebug;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const playwrightMcpCli = path.join(repositoryRoot, "node_modules", "@playwright", "mcp", "cli.js");

function printHelp() {
  process.stdout.write(`Usage: npm run verify:agent-ui -- [options]

Options:
  --wait=MS   Wait up to MS milliseconds for Electron and Vite (maximum 120000)
  --json      Print a machine-readable result
  --help      Show this help
`);
}

try {
  const options = parseVerifyOptions(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  assertSupportedNodeVersion();
  try {
    await access(playwrightMcpCli);
  } catch {
    throw new Error("Playwright MCP is not installed; run 'npm ci' first");
  }

  const port = parseAgentDebugPort(process.env.TASK_MANAGE_CDP_PORT || DEFAULT_AGENT_DEBUG_PORT);
  const endpoint = `http://127.0.0.1:${port}`;
  const result = await waitForAgentUi({ endpoint, waitMs: options.waitMs });
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ready: true, ...result })}\n`);
  } else {
    process.stdout.write(
      `Agent UI is ready: ${result.renderer.title} (${result.renderer.url}) via ${endpoint}\n` +
        "This is the real Electron renderer; keep 'npm run dev:web' running while you inspect it.\n"
    );
  }
} catch (error) {
  const jsonRequested = process.argv.includes("--json");
  if (jsonRequested) {
    process.stdout.write(`${JSON.stringify({ ready: false, error: error.message })}\n`);
  } else {
    process.stderr.write(
      `Agent UI is not ready. Start it with 'npm run dev:web', then retry with ` +
        `'npm run verify:agent-ui -- --wait=30000'.\n${error.message}\n`
    );
  }
  process.exitCode = 1;
}
