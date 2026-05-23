const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const workspace = require("./workspace");

const INBOX_DIR_NAME = "_inbox";
const INBOX_KIND = "inbox";

/**
 * Resolve the inbox directory for a given workspace path.
 * Does not create the directory.
 */
function getInboxDir(workspacePath) {
  if (!workspacePath || typeof workspacePath !== "string") {
    throw new Error("Invalid workspacePath");
  }
  return path.join(workspacePath, INBOX_DIR_NAME);
}

/**
 * Ensure the inbox directory and its root _project.md exist for the workspace.
 * The marker file has `kind: inbox` in its frontmatter so the directory can be
 * distinguished from regular workspace projects at parse time.
 * Returns { projectDir, rootId }.
 */
async function ensureInbox(workspacePath, options = {}) {
  const projectDir = getInboxDir(workspacePath);
  await fs.promises.mkdir(projectDir, { recursive: true });

  const markerPath = path.join(projectDir, "_project.md");
  if (fs.existsSync(markerPath)) {
    const content = await fs.promises.readFile(markerPath, "utf8");
    const { data } = workspace.parseFrontmatter(content);
    if (data.id) {
      return { projectDir, rootId: data.id };
    }
    // Marker exists but is corrupt — overwrite with a fresh id.
  }

  const rootId = crypto.randomUUID();
  const today = new Date().toISOString().slice(0, 10);
  const frontmatter = {
    id: rootId,
    name: "Inbox",
    status: "Open",
    kind: INBOX_KIND,
    created: today,
  };
  await workspace.writeFileIfChanged(
    markerPath,
    workspace.stringifyFrontmatter(frontmatter),
    undefined,
    options.onWritten
  );
  return { projectDir, rootId };
}

/**
 * Read the inbox state. Ensures the inbox exists first.
 * Returns { projectDir, rootId, tasks: Map<id, WorkspaceTask>, taskDirs: Map<id, dirName> }.
 */
async function readInbox(workspacePath, options = {}) {
  const { projectDir, rootId } = await ensureInbox(workspacePath, options);
  const { tasks, taskDirs } = workspace.readProject(projectDir);
  // Defensive: clamp any non-root inbox tasks to parents = [rootId].
  // (User-edited frontmatter or merge artefacts could otherwise leak through.)
  for (const task of tasks.values()) {
    if (task.id === rootId) continue;
    if (task.parents.length !== 1 || task.parents[0] !== rootId) {
      task.parents = [rootId];
    }
  }
  return { projectDir, rootId, tasks, taskDirs };
}

function nextSiblingOrder(tasks, parentId) {
  const siblings = [];
  for (const task of tasks.values()) {
    if (task.parents.length === 1 && task.parents[0] === parentId) {
      siblings.push(task);
    }
  }
  if (siblings.length === 0) return 0;
  const maxOrder = siblings
    .map((task) => (typeof task.order === "number" ? task.order : -1))
    .reduce((a, b) => Math.max(a, b), -1);
  return maxOrder + 1;
}

/**
 * Append a single item to the inbox. The new task is forced to be a direct
 * child of the inbox root (flat structure).
 * Returns { task, projectDir, rootId }.
 */
async function addInboxItem(workspacePath, partialItem = {}, options = {}) {
  const { projectDir, rootId, tasks, taskDirs } = await readInbox(workspacePath, options);
  const today = new Date().toISOString().slice(0, 10);
  const task = {
    id: typeof partialItem.id === "string" && partialItem.id ? partialItem.id : crypto.randomUUID(),
    name: typeof partialItem.name === "string" ? partialItem.name : "",
    status: partialItem.status || "Open",
    startDate: partialItem.startDate || undefined,
    dueDate: partialItem.dueDate || undefined,
    parents: [rootId],
    memos: Array.isArray(partialItem.memos) ? partialItem.memos : [],
    createdAt: today,
    order: nextSiblingOrder(tasks, rootId),
  };
  await workspace.writeTaskAsync(projectDir, task, taskDirs, options.onWritten);
  tasks.set(task.id, task);
  return { task, projectDir, rootId, tasks, taskDirs };
}

/**
 * Move a directory across the filesystem. Falls back to copy + remove for
 * cross-device renames (EXDEV) — uncommon for workspace internal moves but
 * cheap to guard against.
 */
async function moveDirectory(sourceDir, targetDir) {
  try {
    await fs.promises.rename(sourceDir, targetDir);
    return;
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
  }
  await fs.promises.cp(sourceDir, targetDir, { recursive: true });
  await fs.promises.rm(sourceDir, { recursive: true, force: true });
}

function uniqueDirName(parentDir, desired) {
  if (!fs.existsSync(path.join(parentDir, desired))) return desired;
  let i = 2;
  while (fs.existsSync(path.join(parentDir, `${desired}-${i}`))) i++;
  return `${desired}-${i}`;
}

/**
 * Move inbox items into a target workspace project.
 * Each item is appended as the last child of `targetParentId` (or the
 * project root when `targetParentId` is null/undefined).
 *
 * The entire task directory (including memos and assets/) is moved as-is so
 * relative asset paths stay valid in the destination.
 *
 * Returns { moved, errors, inboxState, targetState }.
 */
async function sendInboxItemsToProject(
  workspacePath,
  targetProjectDir,
  taskIds,
  targetRootId,
  options = {}
) {
  const { targetParentId, onWritten } = options;
  const moved = [];
  const errors = [];

  const inboxState = await readInbox(workspacePath, options);
  const {
    projectDir: inboxDir,
    rootId: inboxRootId,
    tasks: inboxTasks,
    taskDirs: inboxTaskDirs,
  } = inboxState;

  const targetState = workspace.readProject(targetProjectDir);
  const targetTasks = targetState.tasks;
  const targetTaskDirs = targetState.taskDirs;

  if (!targetTasks.has(targetRootId)) {
    throw new Error("Target project root task was not found");
  }

  // Resolve the parent: either the explicit parent or the project root.
  const resolvedParentId = targetParentId || targetRootId;
  if (!targetTasks.has(resolvedParentId)) {
    throw new Error("Target parent task was not found in the project");
  }

  let nextOrder = nextSiblingOrder(targetTasks, resolvedParentId);

  for (const taskId of taskIds) {
    try {
      if (taskId === inboxRootId) {
        throw new Error("Cannot send the inbox root");
      }
      const inboxTask = inboxTasks.get(taskId);
      if (!inboxTask) {
        throw new Error("Inbox task not found");
      }
      const sourceDirName = inboxTaskDirs.get(taskId);
      if (!sourceDirName || sourceDirName === "_project") {
        throw new Error("Inbox task directory not found");
      }

      const sourceDir = path.join(inboxDir, sourceDirName);
      const desiredDirName = sourceDirName;
      const allocatedDirName = uniqueDirName(targetProjectDir, desiredDirName);
      const targetDir = path.join(targetProjectDir, allocatedDirName);

      await moveDirectory(sourceDir, targetDir);

      const updatedTask = {
        ...inboxTask,
        parents: [resolvedParentId],
        order: nextOrder,
      };
      nextOrder += 1;

      targetTaskDirs.set(taskId, allocatedDirName);
      await workspace.writeTaskAsync(targetProjectDir, updatedTask, targetTaskDirs, onWritten);
      targetTasks.set(taskId, updatedTask);

      inboxTasks.delete(taskId);
      inboxTaskDirs.delete(taskId);

      moved.push(taskId);
    } catch (err) {
      errors.push({ taskId, error: err && err.message ? err.message : String(err) });
    }
  }

  return {
    moved,
    errors,
    inboxState: {
      projectDir: inboxDir,
      rootId: inboxRootId,
      tasks: inboxTasks,
      taskDirs: inboxTaskDirs,
    },
    targetState: {
      projectDir: targetProjectDir,
      tasks: targetTasks,
      taskDirs: targetTaskDirs,
    },
  };
}

module.exports = {
  INBOX_DIR_NAME,
  INBOX_KIND,
  getInboxDir,
  ensureInbox,
  readInbox,
  addInboxItem,
  sendInboxItemsToProject,
};
