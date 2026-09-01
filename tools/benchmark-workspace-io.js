const fs = require("fs");
const os = require("os");
const path = require("path");
const { performance } = require("perf_hooks");

process.env.TASK_MANAGE_PERF = "1";

const { PerformanceMetrics, performanceMetrics } = require("../electron/performance-metrics");
const workspace = require("../electron/workspace");

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

function buildTasks(projectIndex, taskCount) {
  const rootId = `project-${projectIndex}`;
  const createdAt = "2026-01-01";
  const tasks = [
    {
      id: rootId,
      name: `Performance Project ${projectIndex}`,
      status: "Open",
      parents: [],
      memos: [],
      createdAt,
      order: projectIndex,
    },
  ];

  for (let taskIndex = 0; taskIndex < taskCount; taskIndex += 1) {
    tasks.push({
      id: `project-${projectIndex}-task-${taskIndex}`,
      name: `Task ${taskIndex}`,
      status: taskIndex % 3 === 0 ? "In Progress" : "Open",
      parents: [rootId],
      memos: [
        {
          id: `memo-${projectIndex}-${taskIndex}`,
          title: `Memo ${taskIndex}`,
          format: "markdown",
          content: `# Memo ${taskIndex}\n\nBenchmark fixture content.`,
          tags: ["performance"],
        },
      ],
      createdAt,
      order: taskIndex,
    });
  }
  return tasks;
}

async function probeEventLoop(metrics, name, operation) {
  const startedAt = performance.now();
  let timerDelayMs = 0;
  const timer = new Promise((resolve) => {
    setTimeout(() => {
      timerDelayMs = performance.now() - startedAt;
      resolve();
    }, 0);
  });

  const result = await operation();
  await timer;
  metrics.record(`eventLoop.${name}`, timerDelayMs);
  return result;
}

async function createFixture(fixtureDir, projectCount, taskCount) {
  const projects = [];
  for (let projectIndex = 0; projectIndex < projectCount; projectIndex += 1) {
    const rootId = `project-${projectIndex}`;
    const created = await workspace.createProjectAsync(
      fixtureDir,
      `Performance Project ${projectIndex}`,
      rootId,
      projectIndex
    );
    const tasks = buildTasks(projectIndex, taskCount);
    await workspace.writeProjectAsync(created.projectDir, tasks);
    projects.push({ ...created, tasks });
  }
  return projects;
}

async function runIteration(fixtureDir, selectedProject, eventLoopMetrics, iteration) {
  const projects = await probeEventLoop(eventLoopMetrics, "listProjectsAsync", () =>
    workspace.listProjectsAsync(fixtureDir)
  );
  workspace.listProjects(fixtureDir);

  const asyncProject = await probeEventLoop(eventLoopMetrics, "readProjectAsync", () =>
    workspace.readProjectAsync(selectedProject.projectDir, { includeMemoContent: false })
  );
  workspace.readProject(selectedProject.projectDir, { includeMemoContent: false });

  const taskId = selectedProject.tasks[1].id;
  await probeEventLoop(eventLoopMetrics, "readTaskMemosAsync", () =>
    workspace.readTaskMemosAsync(selectedProject.projectDir, taskId, asyncProject.taskDirs)
  );
  workspace.readTaskMemos(selectedProject.projectDir, taskId, asyncProject.taskDirs);

  await probeEventLoop(eventLoopMetrics, "writeProjectAsync", () =>
    workspace.writeProjectAsync(selectedProject.projectDir, selectedProject.tasks)
  );

  const changedTask = {
    ...selectedProject.tasks[1],
    name: `Task 0 iteration ${iteration % 2}`,
  };
  await probeEventLoop(eventLoopMetrics, "writeProjectPatchAsync", () =>
    workspace.writeProjectPatchAsync(selectedProject.projectDir, { tasks: [changedTask] })
  );
  selectedProject.tasks[1] = changedTask;

  await probeEventLoop(eventLoopMetrics, "setProjectOrderAsync", () =>
    workspace.setProjectOrderAsync(fixtureDir, projects)
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
    const projects = await createFixture(fixtureDir, projectCount, taskCount);
    const selectedProject = projects[0];
    const eventLoopMetrics = new PerformanceMetrics({ enabled: true });

    await runIteration(fixtureDir, selectedProject, eventLoopMetrics, -1);
    performanceMetrics.reset();
    eventLoopMetrics.reset();

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      await runIteration(fixtureDir, selectedProject, eventLoopMetrics, iteration);
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          schemaVersion: 1,
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
