import agentDebug from "../electron/agent-debug.js";

const { DEFAULT_AGENT_DEBUG_PORT, parseAgentDebugPort } = agentDebug;
const port = parseAgentDebugPort(process.env.TASK_MANAGE_CDP_PORT || DEFAULT_AGENT_DEBUG_PORT);
const endpoint = `http://127.0.0.1:${port}`;

try {
  const response = await fetch(`${endpoint}/json/list`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`CDP returned HTTP ${response.status}`);
  }

  const targets = await response.json();
  const rendererTarget = targets.find(
    (target) =>
      target.type === "page" && /^http:\/\/(localhost|127\.0\.0\.1):5173\//.test(target.url)
  );
  if (!rendererTarget) {
    throw new Error("CDP is reachable, but no task-manage renderer target was found");
  }

  process.stdout.write(
    `Agent UI is ready: ${rendererTarget.title || "task-manage"} (${rendererTarget.url}) via ${endpoint}\n`
  );
} catch (error) {
  process.stderr.write(
    `Agent UI is not ready at ${endpoint}. Start it with 'npm run dev:agent'.\n${error.message}\n`
  );
  process.exitCode = 1;
}
