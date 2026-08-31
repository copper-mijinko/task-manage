const DEFAULT_AGENT_DEBUG_PORT = 9222;

function parseAgentDebugPort(rawPort = DEFAULT_AGENT_DEBUG_PORT) {
  const normalized = String(rawPort).trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error("TASK_MANAGE_CDP_PORT must be an integer between 1024 and 65535");
  }

  const port = Number(normalized);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error("TASK_MANAGE_CDP_PORT must be an integer between 1024 and 65535");
  }

  return port;
}

function configureAgentDebugging(electronApp, env = process.env) {
  if (env.TASK_MANAGE_AGENT_UI !== "true") return null;

  if (env.VITE_DEV !== "true") {
    throw new Error("Agent UI debugging is available only through the Vite development server");
  }
  if (electronApp.isPackaged) {
    throw new Error("Agent UI debugging cannot be enabled in a packaged build");
  }
  if (env.PLAYWRIGHT_TEST === "true") {
    throw new Error("Agent UI debugging must not be enabled by the automated E2E test runner");
  }

  const port = parseAgentDebugPort(env.TASK_MANAGE_CDP_PORT);
  electronApp.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
  electronApp.commandLine.appendSwitch("remote-debugging-port", String(port));
  // Codex often drives the Electron renderer while its native window is
  // occluded by Codex Desktop. Chromium otherwise throttles animation frames
  // so aggressively that Playwright cannot complete its normal actionability
  // check (two stable frames) and ordinary clicks time out.
  electronApp.commandLine.appendSwitch("disable-background-timer-throttling");
  electronApp.commandLine.appendSwitch("disable-renderer-backgrounding");
  electronApp.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

  return { host: "127.0.0.1", port };
}

module.exports = {
  DEFAULT_AGENT_DEBUG_PORT,
  configureAgentDebugging,
  parseAgentDebugPort,
};
