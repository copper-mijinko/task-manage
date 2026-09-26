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

function createWorkspaceAuthorizer({ getWorkspacePaths, fsPromises = fs.promises }) {
  const workspaceAuthorizationCache = new Map();

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

  function reset() {
    workspaceAuthorizationCache.clear();
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
    assertKnownWorkspace,
    findKnownWorkspace,
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
