// Renderer-only recovery state. Failed saves survive editor unmounts without
// adding UI state to a node or replacing the canonical persistence queue.
export const pendingMemoDrafts = new Map<string, { content: unknown }>();
