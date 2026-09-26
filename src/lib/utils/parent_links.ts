import type { WorkspaceParentLink } from "@app-types/workspace";

/** 親 id だけが要る呼び出し向け。 */
export function parentIdsOf(parents: readonly WorkspaceParentLink[] | undefined): string[] {
  return (parents ?? []).map((parent) => parent.id);
}
