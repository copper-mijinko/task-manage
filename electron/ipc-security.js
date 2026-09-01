const fs = require("fs");
const path = require("path");
const { fileURLToPath } = require("url");

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);
const ALLOWED_RENDERER_FILES = new Set(["index.html", "detail.html"]);
const ALLOWED_DEV_PATHS = new Set(["/", "/index.html", "/detail.html"]);

function normalizePathForCompare(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function senderFrameUrl(event) {
  return event?.senderFrame?.url || event?.sender?.getURL?.() || "";
}

function createIpcSenderValidator({ rendererDirectory, devOrigins = [] }) {
  const rendererRoot = normalizePathForCompare(rendererDirectory);
  const allowedDevOrigins = new Set(devOrigins);

  return function isTrustedIpcSender(event) {
    if (event?.senderFrame?.top && event.senderFrame.top !== event.senderFrame) {
      return false;
    }

    let senderUrl;
    try {
      senderUrl = new URL(senderFrameUrl(event));
    } catch {
      return false;
    }

    if (senderUrl.protocol === "file:") {
      if (!rendererRoot) return false;
      let senderPath;
      try {
        senderPath = path.resolve(fileURLToPath(senderUrl));
      } catch {
        return false;
      }
      const senderDirectory = normalizePathForCompare(path.dirname(senderPath));
      return (
        senderDirectory === rendererRoot && ALLOWED_RENDERER_FILES.has(path.basename(senderPath))
      );
    }

    return allowedDevOrigins.has(senderUrl.origin) && ALLOWED_DEV_PATHS.has(senderUrl.pathname);
  };
}

function parseAllowedExternalUrl(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const url = new URL(value);
    return ALLOWED_EXTERNAL_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function isDirectChild(parentPath, childPath) {
  const relativePath = path.relative(parentPath, childPath);
  return (
    relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath) &&
    path.dirname(relativePath) === "."
  );
}

function createWorkspaceAuthorizer({ getWorkspacePaths, fsPromises = fs.promises }) {
  const workspaceAuthorizationCache = new Map();
  const projectAuthorizationCache = new Map();

  function knownWorkspacePaths() {
    return [...new Set((getWorkspacePaths?.() || []).filter((item) => typeof item === "string"))];
  }

  function findKnownWorkspace(workspacePath) {
    const requestedPath = normalizePathForCompare(workspacePath);
    if (!requestedPath) return null;
    return (
      knownWorkspacePaths().find(
        (knownPath) => normalizePathForCompare(knownPath) === requestedPath
      ) || null
    );
  }

  function findProjectWorkspace(projectDir) {
    const requestedProject = normalizePathForCompare(projectDir);
    if (!requestedProject) return null;
    return (
      knownWorkspacePaths().find((workspacePath) => {
        const requestedWorkspace = normalizePathForCompare(workspacePath);
        return requestedWorkspace && isDirectChild(requestedWorkspace, requestedProject);
      }) || null
    );
  }

  async function assertKnownWorkspace(workspacePath) {
    const knownPath = findKnownWorkspace(workspacePath);
    if (!knownPath) throw new Error("Workspace is not registered");
    const cacheKey = normalizePathForCompare(knownPath);
    if (!workspaceAuthorizationCache.has(cacheKey)) {
      const authorization = (async () => {
        const [knownRealPath, requestedRealPath] = await Promise.all([
          fsPromises.realpath(knownPath),
          fsPromises.realpath(workspacePath),
        ]);
        if (normalizePathForCompare(knownRealPath) !== normalizePathForCompare(requestedRealPath)) {
          throw new Error("Workspace path does not match the registered workspace");
        }

        const stats = await fsPromises.stat(requestedRealPath);
        if (!stats.isDirectory()) throw new Error("Workspace path is not a directory");
        return { requestedPath: path.resolve(workspacePath), realPath: requestedRealPath };
      })();
      workspaceAuthorizationCache.set(cacheKey, authorization);
      authorization.catch(() => workspaceAuthorizationCache.delete(cacheKey));
    }
    return (await workspaceAuthorizationCache.get(cacheKey)).requestedPath;
  }

  async function assertKnownProject(projectDir) {
    const workspacePath = findProjectWorkspace(projectDir);
    if (!workspacePath) {
      throw new Error("Project is not a direct child of a registered workspace");
    }

    const projectCacheKey = normalizePathForCompare(projectDir);
    const workspaceCacheKey = normalizePathForCompare(workspacePath);
    const cached = projectAuthorizationCache.get(projectCacheKey);
    if (cached?.workspaceCacheKey === workspaceCacheKey) {
      return cached.authorization;
    }

    const authorization = (async () => {
      await assertKnownWorkspace(workspacePath);
      const workspaceRealPath = (await workspaceAuthorizationCache.get(workspaceCacheKey)).realPath;
      const projectRealPath = await fsPromises.realpath(projectDir);
      if (!isDirectChild(workspaceRealPath, projectRealPath)) {
        throw new Error("Project resolves outside its registered workspace");
      }

      const [projectStats, markerStats] = await Promise.all([
        fsPromises.stat(projectRealPath),
        fsPromises.stat(path.join(projectRealPath, "_project.md")),
      ]);
      if (!projectStats.isDirectory() || !markerStats.isFile()) {
        throw new Error("Project directory is invalid");
      }
      return path.resolve(projectDir);
    })();
    projectAuthorizationCache.set(projectCacheKey, { workspaceCacheKey, authorization });
    authorization.catch(() => projectAuthorizationCache.delete(projectCacheKey));
    return authorization;
  }

  function forgetProject(projectDir) {
    const cacheKey = normalizePathForCompare(projectDir);
    if (cacheKey) projectAuthorizationCache.delete(cacheKey);
  }

  function reset() {
    workspaceAuthorizationCache.clear();
    projectAuthorizationCache.clear();
  }

  async function isInsideKnownWorkspace(targetPath) {
    if (typeof targetPath !== "string" || targetPath.trim() === "") return false;
    let targetRealPath;
    try {
      targetRealPath = await fsPromises.realpath(targetPath);
    } catch {
      return false;
    }

    for (const workspacePath of knownWorkspacePaths()) {
      try {
        const workspaceRealPath = await fsPromises.realpath(workspacePath);
        const relativePath = path.relative(workspaceRealPath, targetRealPath);
        if (
          relativePath !== "" &&
          !relativePath.startsWith("..") &&
          !path.isAbsolute(relativePath)
        ) {
          return true;
        }
      } catch {
        // A stale workspace registration grants no access.
      }
    }
    return false;
  }

  return {
    assertKnownProject,
    assertKnownWorkspace,
    findKnownWorkspace,
    forgetProject,
    isInsideKnownWorkspace,
    reset,
  };
}

function validateWorkspaceConfig({ config, currentWorkspacePaths, approvedWorkspacePaths }) {
  if (!config || !Array.isArray(config.workspaces)) {
    throw new Error("Invalid workspace configuration");
  }

  const allowedPaths = new Set(
    [...currentWorkspacePaths, ...approvedWorkspacePaths]
      .map(normalizePathForCompare)
      .filter(Boolean)
  );
  const seen = new Set();
  const workspaces = [];

  for (const item of config.workspaces) {
    const normalizedPath = normalizePathForCompare(item?.path);
    if (!normalizedPath || !allowedPaths.has(normalizedPath)) {
      throw new Error("Workspace was not approved by the directory picker");
    }
    if (seen.has(normalizedPath)) continue;
    seen.add(normalizedPath);
    workspaces.push({
      path: path.resolve(item.path),
      label: typeof item.label === "string" ? item.label.slice(0, 200) : path.basename(item.path),
    });
  }

  let activeWorkspace = config.activeWorkspace;
  if (activeWorkspace === undefined) {
    activeWorkspace = workspaces[0]?.path ?? null;
  } else if (activeWorkspace !== null) {
    const normalizedActive = normalizePathForCompare(activeWorkspace);
    const activeItem = workspaces.find(
      (item) => normalizePathForCompare(item.path) === normalizedActive
    );
    if (!activeItem) throw new Error("Active workspace is not registered");
    activeWorkspace = activeItem.path;
  }

  return { workspaces, activeWorkspace };
}

module.exports = {
  createIpcSenderValidator,
  createWorkspaceAuthorizer,
  normalizePathForCompare,
  parseAllowedExternalUrl,
  validateWorkspaceConfig,
};
