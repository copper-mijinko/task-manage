const DEFAULT_WAIT_MS = 0;
const MAX_WAIT_MS = 120_000;
const RETRY_INTERVAL_MS = 250;
const RENDERER_URL_PATTERN = /^http:\/\/(?:localhost|127\.0\.0\.1):5173(?:\/|$)/;

function parseWaitMs(value) {
  if (!/^\d+$/.test(value ?? "")) {
    throw new Error("--wait must be an integer number of milliseconds");
  }

  const waitMs = Number(value);
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > MAX_WAIT_MS) {
    throw new Error(`--wait must be between 0 and ${MAX_WAIT_MS} milliseconds`);
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
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  return options;
}

export function assertSupportedNodeVersion(version = process.versions.node) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) {
    throw new Error(`Could not parse Node.js version: ${version}`);
  }

  const [, majorText, minorText] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  if (major !== 22 || minor < 12) {
    throw new Error(`Node.js 22.12 or newer within major version 22 is required; found ${version}`);
  }
}

export function findRendererTarget(targets) {
  if (!Array.isArray(targets)) return null;
  return (
    targets.find(
      (target) => target?.type === "page" && RENDERER_URL_PATTERN.test(target?.url ?? "")
    ) ?? null
  );
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs = 5_000) {
  return fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
}

export async function probeAgentUi({ endpoint, fetchImpl = fetch }) {
  const cdpResponse = await fetchWithTimeout(fetchImpl, `${endpoint}/json/list`);
  if (!cdpResponse.ok) {
    throw new Error(`CDP returned HTTP ${cdpResponse.status}`);
  }

  const rendererTarget = findRendererTarget(await cdpResponse.json());
  if (!rendererTarget) {
    throw new Error("CDP is reachable, but no task-manage Electron renderer target was found");
  }

  const rendererResponse = await fetchWithTimeout(fetchImpl, rendererTarget.url);
  if (!rendererResponse.ok) {
    throw new Error(`Vite renderer returned HTTP ${rendererResponse.status}`);
  }

  return {
    endpoint,
    renderer: {
      id: rendererTarget.id ?? null,
      title: rendererTarget.title || "task-manage",
      url: rendererTarget.url,
    },
  };
}

export async function waitForAgentUi({
  endpoint,
  waitMs = DEFAULT_WAIT_MS,
  fetchImpl = fetch,
  retryIntervalMs = RETRY_INTERVAL_MS,
}) {
  const deadline = Date.now() + waitMs;
  let lastError;

  do {
    try {
      return await probeAgentUi({ endpoint, fetchImpl });
    } catch (error) {
      lastError = error;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(retryIntervalMs, remainingMs)));
  } while (true);

  throw lastError;
}
