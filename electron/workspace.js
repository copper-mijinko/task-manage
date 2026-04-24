const fs = require("fs");
const path = require("path");

/** Convert a human name to a filesystem-safe slug. */
function slugify(name) {
  return (
    String(name)
      .trim()
      .toLowerCase()
      .replace(/[/\\:*?"<>|\x00]/g, "")
      .replace(/\s+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "task"
  );
}

/** Return a name that does not already exist inside parentDir. */
function uniqueName(parentDir, baseName) {
  if (!fs.existsSync(path.join(parentDir, baseName))) return baseName;
  let i = 2;
  while (fs.existsSync(path.join(parentDir, `${baseName}-${i}`))) i++;
  return `${baseName}-${i}`;
}

/**
 * Parse YAML frontmatter from a markdown string.
 * Returns { data: Record<string, string | string[]>, body: string }.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { data: {}, body: content };

  const yaml = match[1];
  const body = content.slice(match[0].length).trim();
  const data = {};
  let currentKey = null;

  for (const line of yaml.split(/\r?\n/)) {
    const listMatch = line.match(/^  - (.+)/);
    if (listMatch && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(listMatch[1].trim());
      continue;
    }
    const kvMatch = line.match(/^([^:]+):\s*(.*)/);
    if (kvMatch) {
      currentKey = kvMatch[1].trim();
      const value = kvMatch[2].trim();
      data[currentKey] = value || null;
    }
  }
  return { data, body };
}

/**
 * Serialize data object + optional body to markdown with YAML frontmatter.
 */
function stringifyFrontmatter(data, body = "") {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${item}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  if (body) lines.push("", body);
  return lines.join("\n") + "\n";
}

/** Read memos from a task directory (all .md files except _index.md). */
function readMemos(taskDir) {
  const memos = [];
  const files = fs
    .readdirSync(taskDir)
    .filter((f) => f.endsWith(".md") && f !== "_index.md")
    .sort();
  for (const file of files) {
    const content = fs.readFileSync(path.join(taskDir, file), "utf8");
    const headingMatch = content.match(/^#\s+(.+)/m);
    const title = headingMatch ? headingMatch[1].trim() : file.replace(/\.md$/, "");
    memos.push({ title, content: content.trim() });
  }
  return memos;
}

/** Read the root task from _project.md inside projectDir. */
function readRootTask(projectDir) {
  const content = fs.readFileSync(path.join(projectDir, "_project.md"), "utf8");
  const { data } = parseFrontmatter(content);
  return {
    id: data.id,
    name: data.name || "",
    status: data.status || "Open",
    dueDate: data.due || undefined,
    parents: [],
    memos: [],
    createdAt: data.created || "",
  };
}

/** Read a regular task from its subdirectory. */
function readTaskDir(taskDir) {
  const content = fs.readFileSync(path.join(taskDir, "_index.md"), "utf8");
  const { data } = parseFrontmatter(content);
  const parents = Array.isArray(data.parents)
    ? data.parents
    : data.parents
      ? [data.parents]
      : [];
  return {
    id: data.id,
    name: data.name || "",
    status: data.status || "Open",
    dueDate: data.due || undefined,
    parents,
    memos: readMemos(taskDir),
    createdAt: data.created || "",
  };
}

/**
 * Read all tasks from a project directory.
 * Returns { tasks: Map<id, task>, taskDirs: Map<id, dirName> }
 */
function readProject(projectDir) {
  const tasks = new Map();
  const taskDirs = new Map();

  const rootFile = path.join(projectDir, "_project.md");
  if (fs.existsSync(rootFile)) {
    const root = readRootTask(projectDir);
    if (root.id) {
      tasks.set(root.id, root);
      taskDirs.set(root.id, "_project");
    }
  }

  const entries = fs.readdirSync(projectDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const taskDir = path.join(projectDir, entry.name);
    if (!fs.existsSync(path.join(taskDir, "_index.md"))) continue;
    try {
      const task = readTaskDir(taskDir);
      if (task.id) {
        tasks.set(task.id, task);
        taskDirs.set(task.id, entry.name);
      }
    } catch (_) {
      // Skip malformed task directories
    }
  }

  return { tasks, taskDirs };
}

/** Write root task to _project.md. */
function writeRootTask(projectDir, task) {
  fs.mkdirSync(projectDir, { recursive: true });
  const data = { id: task.id, name: task.name, status: task.status };
  if (task.dueDate) data.due = task.dueDate;
  data.created = task.createdAt || new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(projectDir, "_project.md"), stringifyFrontmatter(data));
}

/**
 * Write a task to its directory. Creates directory on first write.
 * taskDirs (Map<id, dirName>) is mutated when a new dir is allocated.
 */
function writeTask(projectDir, task, taskDirs) {
  if (!task.parents || task.parents.length === 0) {
    writeRootTask(projectDir, task);
    if (!taskDirs.has(task.id)) taskDirs.set(task.id, "_project");
    return;
  }

  let dirName = taskDirs.get(task.id);
  if (!dirName) {
    dirName = uniqueName(projectDir, slugify(task.name));
    taskDirs.set(task.id, dirName);
  }
  const taskDir = path.join(projectDir, dirName);
  fs.mkdirSync(taskDir, { recursive: true });

  const data = { id: task.id, name: task.name, status: task.status };
  if (task.dueDate) data.due = task.dueDate;
  if (task.parents.length > 0) data.parents = task.parents;
  data.created = task.createdAt || new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(taskDir, "_index.md"), stringifyFrontmatter(data));

  // Replace all memo files
  const existing = fs
    .readdirSync(taskDir)
    .filter((f) => f.endsWith(".md") && f !== "_index.md");
  for (const f of existing) fs.unlinkSync(path.join(taskDir, f));
  for (const memo of task.memos || []) {
    const base = `${slugify(memo.title) || "memo"}.md`;
    const fileName = uniqueName(taskDir, base);
    fs.writeFileSync(path.join(taskDir, fileName), memo.content + "\n");
  }
}

/**
 * Delete a task's directory (and its files).
 * The root task (_project) cannot be deleted here.
 */
function deleteTaskDir(projectDir, taskDirs, taskId) {
  const dirName = taskDirs.get(taskId);
  if (!dirName || dirName === "_project") return;
  const taskDir = path.join(projectDir, dirName);
  if (fs.existsSync(taskDir)) fs.rmSync(taskDir, { recursive: true });
  taskDirs.delete(taskId);
}

/**
 * Create a new project directory with a root _project.md.
 * Returns { dirName, projectDir }.
 */
function createProject(workspacePath, name, id) {
  const dirName = uniqueName(workspacePath, slugify(name) || "project");
  const projectDir = path.join(workspacePath, dirName);
  fs.mkdirSync(projectDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  writeRootTask(projectDir, { id, name, status: "Open", parents: [], memos: [], createdAt: today });
  return { dirName, projectDir };
}

/**
 * List all projects (directories containing _project.md) inside a workspace.
 * Returns WorkspaceProjectListItem[].
 */
function listProjects(workspacePath) {
  if (!fs.existsSync(workspacePath)) return [];
  const entries = fs.readdirSync(workspacePath, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectFile = path.join(workspacePath, entry.name, "_project.md");
    if (!fs.existsSync(projectFile)) continue;
    try {
      const content = fs.readFileSync(projectFile, "utf8");
      const { data } = parseFrontmatter(content);
      projects.push({ name: data.name || entry.name, rootId: data.id, dirName: entry.name });
    } catch (_) {}
  }
  return projects;
}

/**
 * DAG cycle check: would setting taskId's parents to newParents create a cycle?
 * tasks: Map<id, { parents: string[] }>
 */
function wouldCreateCycle(tasks, taskId, newParents) {
  if (!newParents || newParents.length === 0) return false;

  // Self-cycle: taskId is listed as its own parent
  if (newParents.includes(taskId)) return true;

  // Build children map from current parent links
  const children = new Map();
  for (const [id, task] of tasks) {
    for (const parent of task.parents) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(id);
    }
  }

  // BFS from taskId following children. If any newParent is reachable → cycle.
  const visited = new Set();
  const queue = [taskId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    for (const child of children.get(current) || []) {
      if (newParents.includes(child)) return true;
      queue.push(child);
    }
  }
  return false;
}

/**
 * BFS traversal from rootId over a task map.
 * Returns ordered array of task IDs (visited nodes only once).
 */
function bfsFromRoot(tasks, rootId) {
  const children = new Map();
  for (const [id, task] of tasks) {
    for (const parent of task.parents) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(id);
    }
  }

  const visited = new Set();
  const order = [];
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    order.push(current);
    for (const child of children.get(current) || []) {
      queue.push(child);
    }
  }
  return order;
}

module.exports = {
  slugify,
  parseFrontmatter,
  stringifyFrontmatter,
  readProject,
  writeTask,
  deleteTaskDir,
  createProject,
  listProjects,
  wouldCreateCycle,
  bfsFromRoot,
};
