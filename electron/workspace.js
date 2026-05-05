const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

/** Convert a human name to a filesystem-safe slug. */
function slugify(name) {
  return (
    String(name)
      .trim()
      .toLowerCase()
      .replace(/[/\\:*?"<>|]/g, "")
      .split("\0")
      .join("")
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

function extensionFromMimeType(mimeType) {
  switch (String(mimeType || "").toLowerCase()) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/bmp":
      return "bmp";
    case "image/svg+xml":
      return "svg";
    default:
      return "png";
  }
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
    const listMatch = line.match(/^ {2}- (.+)/);
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

/** Read memos from a task directory. */
function readMemos(taskDir, reservedFiles = ["_index.md"]) {
  const memos = [];
  const reserved = new Set(reservedFiles);
  const files = fs
    .readdirSync(taskDir)
    .filter((f) => f.endsWith(".md") && !reserved.has(f))
    .sort();
  for (const file of files) {
    const raw = fs.readFileSync(path.join(taskDir, file), "utf8");
    const { data, body } = parseFrontmatter(raw);
    const id = data.id || crypto.randomUUID();
    const headingMatch = body.match(/^#\s+(.+)/m);
    const fileTitle = file.replace(/\.md$/, "");
    let title = data.title;
    if (!title) {
      if (headingMatch) {
        title = headingMatch[1].trim();
      } else {
        title = data.id === fileTitle ? "memo" : fileTitle;
      }
    }
    const tags = Array.isArray(data.tags) ? data.tags.map(String) : [];
    memos.push({ id, title, content: body.trim(), tags });
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
    startDate: data.start || undefined,
    dueDate: data.due || undefined,
    parents: [],
    memos: readMemos(projectDir, ["_project.md"]),
    createdAt: data.created || "",
  };
}

/** Read a regular task from its subdirectory. */
function readTaskDir(taskDir) {
  const content = fs.readFileSync(path.join(taskDir, "_index.md"), "utf8");
  const { data } = parseFrontmatter(content);
  const parents = Array.isArray(data.parents) ? data.parents : data.parents ? [data.parents] : [];
  return {
    id: data.id,
    name: data.name || "",
    status: data.status || "Open",
    startDate: data.start || undefined,
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
    } catch {
      // Skip malformed task directories
    }
  }

  return { tasks, taskDirs };
}

function writeMemoFiles(taskDir, indexFileName, memos) {
  const existing = fs.readdirSync(taskDir).filter((f) => f.endsWith(".md") && f !== indexFileName);
  for (const f of existing) fs.unlinkSync(path.join(taskDir, f));
  for (const memo of memos || []) {
    const id = memo.id || crypto.randomUUID();
    fs.writeFileSync(
      path.join(taskDir, `${id}.md`),
      stringifyFrontmatter({ id, title: memo.title, tags: memo.tags ?? [] }, memo.content)
    );
  }
}

/** Write root task to _project.md. */
function writeRootTask(projectDir, task) {
  fs.mkdirSync(projectDir, { recursive: true });
  const data = { id: task.id, name: task.name, status: task.status };
  if (task.startDate) data.start = task.startDate;
  if (task.dueDate) data.due = task.dueDate;
  data.created = task.createdAt || new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(projectDir, "_project.md"), stringifyFrontmatter(data));
  writeMemoFiles(projectDir, "_project.md", task.memos);
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
    dirName = task.id;
    taskDirs.set(task.id, dirName);
  }
  const taskDir = path.join(projectDir, dirName);
  fs.mkdirSync(taskDir, { recursive: true });

  const data = { id: task.id, name: task.name, status: task.status };
  if (task.startDate) data.start = task.startDate;
  if (task.dueDate) data.due = task.dueDate;
  if (task.parents.length > 0) data.parents = task.parents;
  data.created = task.createdAt || new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(taskDir, "_index.md"), stringifyFrontmatter(data));

  writeMemoFiles(taskDir, "_index.md", task.memos);
}

function saveMemoImage(projectDir, taskDirs, taskId, bytes, mimeType) {
  const dirName = taskDirs.get(taskId);
  if (!dirName) {
    throw new Error("Task directory was not found");
  }

  const targetDir = dirName === "_project" ? projectDir : path.join(projectDir, dirName);
  const assetsDir = path.join(targetDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  const extension = extensionFromMimeType(mimeType);
  const fileName = `pasted-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${extension}`;
  const assetPath = path.join(assetsDir, fileName);
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

  fs.writeFileSync(assetPath, buffer);

  return {
    fileName,
    relativePath: `./assets/${fileName}`,
    assetPath,
  };
}

function resolveMemoAssetPath(projectDir, taskDirs, taskId, assetPath) {
  const dirName = taskDirs.get(taskId);
  if (!dirName || !assetPath) {
    return null;
  }

  const taskDir = dirName === "_project" ? projectDir : path.join(projectDir, dirName);
  const normalizedAssetPath = String(assetPath).replace(/\\/g, "/").trim();
  const resolvedPath = path.resolve(taskDir, normalizedAssetPath);
  const relativePath = path.relative(taskDir, resolvedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  return pathToFileURL(resolvedPath).toString();
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
      projects.push({
        name: data.name || entry.name,
        rootId: data.id,
        dirName: entry.name,
        projectDir: path.join(workspacePath, entry.name),
      });
    } catch {
      // Ignore malformed project entries
    }
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

  // BFS from taskId following children. If any newParent is reachable, a cycle exists.
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

/**
 * Migrate a ProjectData (legacy db.json tree format) to workspace flat-file format.
 * @param {string} workspacePath  Destination workspace directory.
 * @param {object} projectData    ProjectData: { headers, data: TreeData }
 * @returns {{ dirName: string, projectDir: string, count: number }}
 */
function migrateProjectData(workspacePath, projectData) {
  const tasks = [];
  const today = new Date().toISOString().slice(0, 10);

  function traverse(node, parentIds) {
    const memos = (node.data.memo || []).map((m) => {
      let content = "";
      if (typeof m.content === "string") {
        content = m.content;
      } else if (m.content !== null && m.content !== undefined) {
        // Preserve legacy Quill Delta objects as JSON fenced blocks.
        content = `# ${m.title || "Memo"}\n\n\`\`\`json\n${JSON.stringify(m.content, null, 2)}\n\`\`\``;
      }
      return { id: crypto.randomUUID(), title: String(m.title || "Memo"), content };
    });

    tasks.push({
      id: node.id,
      name: node.data.name || "",
      status: node.data.status || "Open",
      startDate: node.data["start date"] || undefined,
      dueDate: node.data["due date"] || undefined,
      parents: [...parentIds],
      memos,
      createdAt: today,
    });

    for (const child of node.children || []) {
      traverse(child, [node.id]);
    }
  }

  if (!projectData || !projectData.data) throw new Error("Invalid project data");
  traverse(projectData.data, []);

  const rootName = tasks[0].name || "project";
  const dirName = uniqueName(workspacePath, slugify(rootName) || "project");
  const projectDir = path.join(workspacePath, dirName);
  fs.mkdirSync(projectDir, { recursive: true });

  const taskDirs = new Map();
  for (const task of tasks) {
    writeTask(projectDir, task, taskDirs);
  }

  return { dirName, projectDir, count: tasks.length };
}

module.exports = {
  slugify,
  parseFrontmatter,
  stringifyFrontmatter,
  readProject,
  writeTask,
  saveMemoImage,
  resolveMemoAssetPath,
  deleteTaskDir,
  createProject,
  listProjects,
  wouldCreateCycle,
  bfsFromRoot,
  migrateProjectData,
};
