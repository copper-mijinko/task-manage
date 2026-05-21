import { writable, get, type Writable } from "svelte/store";
import * as platform from "@lib/ipc/platform";
import type { WorkspaceConflictPolicy } from "@app-types/app";

const META_KEY = "workspaceConflictPolicy";
const DEFAULT_POLICY: WorkspaceConflictPolicy = "ask";

function isWorkspaceConflictPolicy(value: unknown): value is WorkspaceConflictPolicy {
  return value === "ask" || value === "prefer-memory";
}

export interface WorkspaceConflictPolicyStore extends Writable<WorkspaceConflictPolicy> {
  init: () => Promise<void>;
}

function createPolicyStore(): WorkspaceConflictPolicyStore {
  const { subscribe, set, update } = writable<WorkspaceConflictPolicy>(DEFAULT_POLICY);

  return {
    subscribe,
    set(value) {
      set(value);
      platform.setMetaData(META_KEY, value);
    },
    update(updater) {
      update((current) => {
        const next = updater(current);
        platform.setMetaData(META_KEY, next);
        return next;
      });
    },
    async init() {
      try {
        const value = await platform.getMetaData(META_KEY);
        set(isWorkspaceConflictPolicy(value) ? value : DEFAULT_POLICY);
      } catch {
        set(DEFAULT_POLICY);
      }
    },
  };
}

export const workspace_conflict_policy = createPolicyStore();

/** Synchronous accessor used by save paths that don't want to subscribe. */
export function isPreferMemoryActive(): boolean {
  return get(workspace_conflict_policy) === "prefer-memory";
}
