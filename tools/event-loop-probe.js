const { performance } = require("perf_hooks");

const DEFAULT_HEARTBEAT_MS = 5;

/**
 * Measure the largest heartbeat drift while an operation is running.
 *
 * A final heartbeat is intentionally allowed to run after the operation settles.
 * This captures synchronous work performed at the end of an otherwise async operation.
 */
async function probeEventLoop(
  metrics,
  name,
  operation,
  { heartbeatMs = DEFAULT_HEARTBEAT_MS } = {}
) {
  if (!Number.isFinite(heartbeatMs) || heartbeatMs <= 0) {
    throw new Error("heartbeatMs must be a positive number");
  }

  let lastHeartbeatAt = performance.now();
  let baselineIntervalMs = heartbeatMs;
  let maxDriftMs = 0;
  let measuring = false;
  let nextHeartbeatResolve = null;
  const heartbeat = setInterval(() => {
    const now = performance.now();
    if (measuring) {
      maxDriftMs = Math.max(maxDriftMs, now - lastHeartbeatAt - baselineIntervalMs, 0);
    } else {
      // Calibrate against the host timer quantum. Windows may turn a requested
      // 5 ms timer into roughly 15.6 ms even when the event loop is idle.
      baselineIntervalMs = Math.max(heartbeatMs, now - lastHeartbeatAt);
    }
    lastHeartbeatAt = now;
    nextHeartbeatResolve?.();
    nextHeartbeatResolve = null;
  }, heartbeatMs);

  // Warm up the interval so timer startup cost is not attributed to the operation.
  await new Promise((resolve) => {
    nextHeartbeatResolve = resolve;
  });
  measuring = true;

  try {
    return await operation();
  } finally {
    // Let an overdue heartbeat run before stopping the probe. Without this final
    // turn, synchronous work immediately before operation completion is missed.
    await new Promise((resolve) => {
      nextHeartbeatResolve = resolve;
    });
    clearInterval(heartbeat);
    metrics.record(`eventLoop.${name}`, maxDriftMs);
  }
}

module.exports = { probeEventLoop };
