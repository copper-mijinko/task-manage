const fs = require("fs");
const os = require("os");
const path = require("path");
process.env.TASK_MANAGE_PERF = "1";

const { PerformanceMetrics, performanceMetrics } = require("../electron/performance-metrics");
const workspaceGraph = require("../electron/workspace-graph");
const { probeEventLoop } = require("./event-loop-probe");

function readOption(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for --${name}`);
  }
  return value;
}

function readPositiveInteger(name, fallback) {
  const value = Number(readOption(name, fallback));
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return value;
}

/**
 * ワークスペースの正本（`.task-manage/graph-v1.json`）を直接作る。
 * プロジェクト数 × ノード数のノードを持ち、各ノードに短い本文を付ける。
 */
async function createFixture(fixtureDir, projectCount, taskCount) {
  const createdAt = "2026-01-01";
  const rootId = "workspace-root";
  const nodes = { [rootId]: { id: rootId, name: "Benchmark", parents: [], createdAt } };
  for (let projectIndex = 0; projectIndex < projectCount; projectIndex += 1) {
    const projectId = `project-${projectIndex}`;
    nodes[projectId] = {
      id: projectId,
      name: `Performance Project ${projectIndex}`,
      status: "Open",
      parents: [{ id: rootId, order: projectIndex }],
      createdAt,
    };
    for (let taskIndex = 0; taskIndex < taskCount; taskIndex += 1) {
      const id = `${projectId}-task-${taskIndex}`;
      nodes[id] = {
        id,
        name: `Task ${taskIndex}`,
        status: taskIndex % 3 === 0 ? "In Progress" : "Open",
        parents: [{ id: projectId, order: taskIndex }],
        body: `# Task ${taskIndex}\n\nBenchmark fixture content.`,
        format: "markdown",
        tags: ["performance"],
        createdAt,
      };
    }
  }
  const graph = { schemaVersion: 1, workspaceId: "benchmark", rootId, revision: 0, nodes };
  await fs.promises.mkdir(path.join(fixtureDir, ".task-manage"), { recursive: true });
  await fs.promises.writeFile(
    workspaceGraph.graphPath(fixtureDir),
    JSON.stringify({ schemaVersion: 1, graph, undo: [], redo: [] })
  );
}

/** イベントループの遅れと所要時間の両方を記録する。 */
function measure(eventLoopMetrics, name, operation) {
  return probeEventLoop(eventLoopMetrics, name, () =>
    performanceMetrics.measureAsync(`graph.${name}`, operation)
  );
}

async function runIteration(fixtureDir, eventLoopMetrics, iteration) {
  const graph = await measure(eventLoopMetrics, "readWorkspaceGraph", () =>
    workspaceGraph.readWorkspaceGraph(fixtureDir)
  );
  const renamed = await measure(eventLoopMetrics, "executeWorkspaceGraphCommand", () =>
    workspaceGraph.executeWorkspaceGraphCommand(
      fixtureDir,
      {
        type: "update-node",
        nodeId: "project-0-task-1",
        changes: { name: `Task 1 iteration ${iteration}` },
      },
      "tree",
      graph.revision
    )
  );
  const undone = await measure(eventLoopMetrics, "undoWorkspaceGraph", () =>
    workspaceGraph.undoWorkspaceGraph(fixtureDir, renamed.graph.revision)
  );
  await measure(eventLoopMetrics, "redoWorkspaceGraph", () =>
    workspaceGraph.redoWorkspaceGraph(fixtureDir, undone.graph.revision)
  );
}

async function main() {
  const iterations = readPositiveInteger("iterations", 20);
  const projectCount = readPositiveInteger("projects", 8);
  const taskCount = readPositiveInteger("tasks", 30);
  const requestedRoot = readOption("root", "");
  const benchmarkRoot = path.resolve(requestedRoot || os.tmpdir());
  const rootStats = await fs.promises.stat(benchmarkRoot);
  if (!rootStats.isDirectory()) throw new Error("Benchmark root is not a directory");

  const fixtureDir = await fs.promises.mkdtemp(path.join(benchmarkRoot, "task-manage-perf-"));
  const resolvedFixture = path.resolve(fixtureDir);
  const safePrefix = `${benchmarkRoot}${path.sep}`;
  if (
    !resolvedFixture.startsWith(safePrefix) ||
    !path.basename(resolvedFixture).startsWith("task-manage-perf-")
  ) {
    throw new Error("Refusing to use an unsafe benchmark fixture path");
  }

  try {
    await createFixture(fixtureDir, projectCount, taskCount);
    const eventLoopMetrics = new PerformanceMetrics({ enabled: true });

    await runIteration(fixtureDir, eventLoopMetrics, -1);
    performanceMetrics.reset();
    eventLoopMetrics.reset();

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      await runIteration(fixtureDir, eventLoopMetrics, iteration);
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          schemaVersion: 3,
          fixture: {
            storage: requestedRoot ? "custom-root" : "os-temp",
            iterations,
            projectCount,
            tasksPerProject: taskCount,
          },
          duration: performanceMetrics.summary(),
          eventLoopDelay: eventLoopMetrics.summary(),
        },
        null,
        2
      )}\n`
    );
  } finally {
    await fs.promises.rm(resolvedFixture, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`Workspace benchmark failed: ${error.message}\n`);
  process.exitCode = 1;
});
