const { performance } = require("perf_hooks");

const DEFAULT_MAX_SAMPLES = 500;

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) return 0;
  const index = Math.max(
    0,
    Math.min(sortedValues.length - 1, Math.ceil((percentileValue / 100) * sortedValues.length) - 1)
  );
  return sortedValues[index];
}

function roundMilliseconds(value) {
  return Math.round(value * 100) / 100;
}

class PerformanceMetrics {
  constructor({ enabled = false, maxSamples = DEFAULT_MAX_SAMPLES } = {}) {
    this.enabled = Boolean(enabled);
    this.maxSamples = Math.max(1, Number(maxSamples) || DEFAULT_MAX_SAMPLES);
    this.samples = new Map();
  }

  record(name, durationMs) {
    if (!this.enabled || typeof name !== "string" || !name) return;
    if (!Number.isFinite(durationMs) || durationMs < 0) return;

    let values = this.samples.get(name);
    if (!values) {
      values = [];
      this.samples.set(name, values);
    }
    values.push(durationMs);
    if (values.length > this.maxSamples) {
      values.shift();
    }
  }

  measureSync(name, operation) {
    if (!this.enabled) return operation();
    const startedAt = performance.now();
    try {
      return operation();
    } finally {
      this.record(name, performance.now() - startedAt);
    }
  }

  async measureAsync(name, operation) {
    if (!this.enabled) return operation();
    const startedAt = performance.now();
    try {
      return await operation();
    } finally {
      this.record(name, performance.now() - startedAt);
    }
  }

  summary() {
    const result = {};
    for (const [name, values] of [...this.samples.entries()].sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      const sorted = [...values].sort((a, b) => a - b);
      result[name] = {
        count: sorted.length,
        p50Ms: roundMilliseconds(percentile(sorted, 50)),
        p95Ms: roundMilliseconds(percentile(sorted, 95)),
        maxMs: roundMilliseconds(sorted[sorted.length - 1] ?? 0),
      };
    }
    return result;
  }

  reset() {
    this.samples.clear();
  }
}

const performanceMetrics = new PerformanceMetrics({
  enabled: process.env.TASK_MANAGE_PERF === "true" || process.env.TASK_MANAGE_PERF === "1",
});

module.exports = {
  PerformanceMetrics,
  performanceMetrics,
};
