import agentDebug from "../electron/agent-debug.js";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentUiDiagnosticError,
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

function serializeError(error) {
  return {
    error: error?.message ?? "Agent UI readiness probe failed",
    errorCode: error?.code ?? "UNKNOWN_FAILURE",
    stage: error?.stage ?? "unknown",
    timedOut: error?.timedOut === true,
    details: error?.details ?? {},
  };
}

function recoveryHint(error) {
  switch (error?.code) {
    case "MCP_PACKAGE_MISSING":
      return "Install repository dependencies with 'npm ci'.";
    case "VITE_UNAVAILABLE":
      return "Start the persistent Agent UI process with 'npm run dev:agent'.";
    case "CDP_UNAVAILABLE":
    case "RENDERER_NOT_FOUND":
      return "Confirm that dev:agent launched Electron with TASK_MANAGE_AGENT_UI=true and CDP port 9222 is free.";
    case "NOT_ELECTRON":
    case "PRELOAD_MISSING":
    case "RENDERER_URL_MISMATCH":
      return "Stop stale development processes, restart 'npm run dev:agent', and do not substitute a normal browser.";
    default:
      return "Review the diagnostic code, restart 'npm run dev:agent' if needed, and retry.";
  }
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
    throw new AgentUiDiagnosticError(
      "MCP_PACKAGE_MISSING",
      "prerequisites",
      "Playwright MCP is not installed; run 'npm ci' first",
      { details: { expectedPath: playwrightMcpCli } }
    );
  }

  const port = parseAgentDebugPort(process.env.TASK_MANAGE_CDP_PORT || DEFAULT_AGENT_DEBUG_PORT);
  const endpoint = `http://127.0.0.1:${port}`;
  const result = await waitForAgentUi({ endpoint, waitMs: options.waitMs });
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ready: true, ...result })}\n`);
  } else {
    process.stdout.write(
      `Agent UI is ready: ${result.renderer.title} (${result.renderer.url}) via ${endpoint}\n` +
        `Electron: ${result.checks.electron.userAgent}\n` +
        `Preload: ${result.checks.preload.bridge} (${result.checks.preload.requiredMethods.join(", ")})\n` +
        "Keep 'npm run dev:agent' running and inspect this renderer only through the configured Playwright MCP.\n"
    );
  }
} catch (error) {
  const jsonRequested = process.argv.includes("--json");
  if (jsonRequested) {
    process.stdout.write(`${JSON.stringify({ ready: false, ...serializeError(error) })}\n`);
  } else {
    const diagnostic = serializeError(error);
    process.stderr.write(
      `Agent UI is not ready [${diagnostic.errorCode}] at ${diagnostic.stage}.\n` +
        `${diagnostic.error}${diagnostic.timedOut ? " (wait timed out)" : ""}\n` +
        `${recoveryHint(error)}\n` +
        "Retry with 'npm run verify:agent-ui -- --wait=30000'.\n"
    );
  }
  process.exitCode = 1;
}
