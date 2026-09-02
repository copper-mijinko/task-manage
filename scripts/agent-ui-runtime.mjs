const DEFAULT_WAIT_MS = 0;
const MAX_WAIT_MS = 120_000;
const RETRY_INTERVAL_MS = 250;
const RENDERER_URL_PATTERN = /^http:\/\/(?:localhost|127\.0\.0\.1):5173(?:\/|$)/;
const MAIN_RENDERER_URL_PATTERN = /^http:\/\/(?:localhost|127\.0\.0\.1):5173\/?$/;
const REQUIRED_PRELOAD_METHODS = ["getProjectIDs", "windowGetState", "wsGetWorkspaces"];

export class AgentUiDiagnosticError extends Error {
  constructor(code, stage, message, { cause, details = {} } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "AgentUiDiagnosticError";
    this.code = code;
    this.stage = stage;
    this.details = details;
    this.timedOut = false;
  }
}

function diagnosticError(code, stage, message, options) {
  return new AgentUiDiagnosticError(code, stage, message, options);
}

function parseWaitMs(value) {
  if (!/^\d+$/.test(value ?? "")) {
    throw diagnosticError(
      "INVALID_ARGUMENT",
      "arguments",
      "--wait must be an integer number of milliseconds"
    );
  }

  const waitMs = Number(value);
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > MAX_WAIT_MS) {
    throw diagnosticError(
      "INVALID_ARGUMENT",
      "arguments",
      `--wait must be between 0 and ${MAX_WAIT_MS} milliseconds`
    );
  }
  return waitMs;
}

export function parseVerifyOptions(argv) {
  const options = { json: false, waitMs: DEFAULT_WAIT_MS, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      options.json = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--wait") {
      index += 1;
      options.waitMs = parseWaitMs(argv[index]);
    } else if (argument.startsWith("--wait=")) {
      options.waitMs = parseWaitMs(argument.slice("--wait=".length));
    } else {
      throw diagnosticError("INVALID_ARGUMENT", "arguments", `Unknown option: ${argument}`);
    }
  }

  return options;
}

export function assertSupportedNodeVersion(version = process.versions.node) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) {
    throw diagnosticError(
      "NODE_VERSION_UNSUPPORTED",
      "prerequisites",
      `Could not parse Node.js version: ${version}`
    );
  }

  const [, majorText, minorText] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  if (major !== 22 || minor < 12) {
    throw diagnosticError(
      "NODE_VERSION_UNSUPPORTED",
      "prerequisites",
      `Node.js 22.12 or newer within major version 22 is required; found ${version}`
    );
  }
}

export function findRendererTarget(targets) {
  if (!Array.isArray(targets)) return null;
  const rendererTargets = targets.filter(
    (target) => target?.type === "page" && RENDERER_URL_PATTERN.test(target?.url ?? "")
  );
  return (
    rendererTargets.find((target) => MAIN_RENDERER_URL_PATTERN.test(target?.url ?? "")) ??
    rendererTargets[0] ??
    null
  );
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs = 5_000) {
  return fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
}

async function fetchRequired(fetchImpl, url, { code, stage, label }) {
  let response;
  try {
    response = await fetchWithTimeout(fetchImpl, url);
  } catch (cause) {
    throw diagnosticError(code, stage, `${label} is not reachable at ${url}`, {
      cause,
      details: { url },
    });
  }

  if (!response.ok) {
    throw diagnosticError(code, stage, `${label} returned HTTP ${response.status}`, {
      details: { status: response.status, url },
    });
  }
  return response;
}

const RENDERER_PROBE_EXPRESSION = `(() => {
  const api = window.electronAPI;
  const requiredMethods = ${JSON.stringify(REQUIRED_PRELOAD_METHODS)};
  return {
    title: document.title,
    href: window.location.href,
    readyState: document.readyState,
    userAgent: navigator.userAgent,
    bridgeType: typeof api,
    preloadMethods: Object.fromEntries(
      requiredMethods.map((name) => [name, typeof api?.[name] === "function"])
    )
  };
})()`;

export async function inspectRendererTarget(
  target,
  { WebSocketImpl = globalThis.WebSocket, timeoutMs = 5_000 } = {}
) {
  if (!target?.webSocketDebuggerUrl) {
    throw diagnosticError(
      "RENDERER_NOT_INSPECTABLE",
      "renderer",
      "The Electron renderer target has no CDP WebSocket URL"
    );
  }
  if (typeof WebSocketImpl !== "function") {
    throw diagnosticError(
      "CDP_INSPECTION_UNAVAILABLE",
      "renderer",
      "This Node.js runtime does not provide the WebSocket API required for CDP inspection"
    );
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = new WebSocketImpl(target.webSocketDebuggerUrl);
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // The diagnostic result is more useful than a close failure.
      }
      callback(value);
    };
    const fail = (message, cause) =>
      finish(
        reject,
        diagnosticError("CDP_INSPECTION_FAILED", "renderer", message, {
          cause,
          details: { targetUrl: target.url },
        })
      );
    const timer = setTimeout(
      () => fail(`Timed out inspecting the Electron renderer after ${timeoutMs}ms`),
      timeoutMs
    );

    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression: RENDERER_PROBE_EXPRESSION, returnByValue: true },
        })
      );
    });
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch (cause) {
        fail("CDP returned an unreadable renderer response", cause);
        return;
      }
      if (message.id !== 1) return;
      if (message.error || message.result?.exceptionDetails) {
        fail("CDP could not evaluate the renderer readiness probe");
        return;
      }
      finish(resolve, message.result?.result?.value);
    });
    socket.addEventListener("error", (event) => {
      fail("Could not open the Electron renderer CDP WebSocket", event.error);
    });
  });
}

export async function probeAgentUi({
  endpoint,
  fetchImpl = fetch,
  inspectRendererImpl = inspectRendererTarget,
  viteUrl = "http://localhost:5173/",
}) {
  await fetchRequired(fetchImpl, viteUrl, {
    code: "VITE_UNAVAILABLE",
    stage: "vite",
    label: "Vite",
  });

  const versionResponse = await fetchRequired(fetchImpl, `${endpoint}/json/version`, {
    code: "CDP_UNAVAILABLE",
    stage: "cdp",
    label: "Electron CDP",
  });
  const cdpVersion = await versionResponse.json();

  const targetsResponse = await fetchRequired(fetchImpl, `${endpoint}/json/list`, {
    code: "CDP_UNAVAILABLE",
    stage: "cdp",
    label: "Electron CDP target list",
  });
  const rendererTarget = findRendererTarget(await targetsResponse.json());
  if (!rendererTarget) {
    throw diagnosticError(
      "RENDERER_NOT_FOUND",
      "renderer",
      "CDP is reachable, but no task-manage renderer target is available"
    );
  }

  const runtime = await inspectRendererImpl(rendererTarget);
  if (!runtime || !/\bElectron\/\d/i.test(runtime.userAgent ?? "")) {
    throw diagnosticError(
      "NOT_ELECTRON",
      "electron",
      "The renderer target does not identify itself as Electron",
      { details: { userAgent: runtime?.userAgent ?? null } }
    );
  }

  const missingMethods = REQUIRED_PRELOAD_METHODS.filter(
    (method) => runtime.preloadMethods?.[method] !== true
  );
  if (runtime.bridgeType !== "object" || missingMethods.length > 0) {
    throw diagnosticError(
      "PRELOAD_MISSING",
      "preload",
      "The task-manage preload bridge is unavailable or incomplete",
      {
        details: {
          bridgeType: runtime.bridgeType ?? null,
          missingMethods,
        },
      }
    );
  }

  if (!RENDERER_URL_PATTERN.test(runtime.href ?? "")) {
    throw diagnosticError(
      "RENDERER_URL_MISMATCH",
      "renderer",
      "The inspected Electron renderer is not the task-manage Vite page",
      { details: { href: runtime.href ?? null } }
    );
  }
  if (!["interactive", "complete"].includes(runtime.readyState)) {
    throw diagnosticError(
      "RENDERER_NOT_READY",
      "renderer",
      `The Electron renderer document is still ${runtime.readyState ?? "unknown"}`
    );
  }

  return {
    endpoint,
    renderer: {
      id: rendererTarget.id ?? null,
      title: runtime.title || rendererTarget.title || "task-manage",
      url: runtime.href,
    },
    checks: {
      vite: { ready: true, url: viteUrl },
      cdp: { ready: true, endpoint, browser: cdpVersion.Browser ?? null },
      electron: { ready: true, userAgent: runtime.userAgent },
      preload: {
        ready: true,
        bridge: "window.electronAPI",
        requiredMethods: [...REQUIRED_PRELOAD_METHODS],
      },
    },
  };
}

export async function waitForAgentUi({
  endpoint,
  waitMs = DEFAULT_WAIT_MS,
  fetchImpl = fetch,
  inspectRendererImpl = inspectRendererTarget,
  retryIntervalMs = RETRY_INTERVAL_MS,
  viteUrl,
}) {
  const deadline = Date.now() + waitMs;
  let lastError;

  for (;;) {
    try {
      return await probeAgentUi({ endpoint, fetchImpl, inspectRendererImpl, viteUrl });
    } catch (error) {
      lastError = error;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(retryIntervalMs, remainingMs)));
  }

  if (!(lastError instanceof AgentUiDiagnosticError)) {
    lastError = diagnosticError(
      "UNKNOWN_FAILURE",
      "unknown",
      lastError?.message ?? "Agent UI readiness probe failed",
      { cause: lastError }
    );
  }
  if (waitMs > 0) {
    lastError.timedOut = true;
    lastError.details = { ...lastError.details, waitMs };
  }
  throw lastError;
}
