function createWorkspaceCacheLoader({ cache, load }) {
  if (!cache || typeof cache.get !== "function" || typeof cache.set !== "function") {
    throw new Error("cache must provide get and set methods");
  }
  if (typeof load !== "function") {
    throw new Error("load is required");
  }

  const loadPromises = new Map();

  async function ensure(projectDir) {
    const cached = cache.get(projectDir);
    if (cached) return cached;

    let loadPromise = loadPromises.get(projectDir);
    if (!loadPromise) {
      loadPromise = (async () => {
        const loaded = await load(projectDir);

        // A renderer snapshot or reconciler update may have populated the cache
        // while disk I/O was pending. Never replace that newer in-memory state.
        const current = cache.get(projectDir);
        if (current) return current;

        cache.set(projectDir, loaded);
        return loaded;
      })();
      loadPromises.set(projectDir, loadPromise);
    }

    try {
      return await loadPromise;
    } finally {
      if (loadPromises.get(projectDir) === loadPromise) {
        loadPromises.delete(projectDir);
      }
    }
  }

  return { ensure };
}

module.exports = { createWorkspaceCacheLoader };
