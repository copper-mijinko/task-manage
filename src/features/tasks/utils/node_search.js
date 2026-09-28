/**
 * ノードの候補を、打った文字で絞り込んで並べる（親の追加・移動先の選択）。
 *
 * VS Code 風に、入力文字が順に含まれていれば拾う（部分一致より緩い）。
 * 部分一致はその位置が前ほど上、そうでなければ連続して一致した長さで
 * 並べるので、素直に打てば目当てが上に来る。
 */

/** `needle` が `text` に順に含まれるときの点数。含まれなければ -1。 */
export function subsequenceScore(text, needle) {
  if (!needle) return 0;
  const haystack = (text ?? "").toLowerCase();
  const direct = haystack.indexOf(needle);
  // 同じ位置で一致したら短い名前（打った語に近いもの）を上にする。
  // 「wor」で Workspace より Work が先に来るように。
  if (direct >= 0) return 1000 - direct - (haystack.length - needle.length) / 1000;
  let cursor = 0;
  let score = 0;
  let streak = 0;
  for (const ch of needle) {
    const at = haystack.indexOf(ch, cursor);
    if (at < 0) return -1;
    streak = at === cursor ? streak + 1 : 0;
    score += streak;
    cursor = at + 1;
  }
  return score;
}

/**
 * `{ id, name, path }` の候補を絞り込んで並べる。`exclude` の id は外す。
 * `needle` は小文字にしてから渡す。
 */
export function rankCandidates(list, needle, exclude = []) {
  const excluded = new Set(exclude);
  const available = (list ?? []).filter((item) => !excluded.has(item.id));
  if (!needle) return available;
  return available
    .map((item) => ({
      item,
      score: Math.max(subsequenceScore(item.name, needle), subsequenceScore(item.path, needle)),
    }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
}

/** `id` の子孫の id（多親もたどる）。移動先の候補から外すのに使う。 */
export function descendantIds(records, id) {
  const children = new Map();
  for (const record of Object.values(records ?? {}))
    for (const parent of record.parents ?? []) {
      if (!children.has(parent.id)) children.set(parent.id, []);
      children.get(parent.id).push(record.id);
    }
  const found = new Set();
  const pending = [...(children.get(id) ?? [])];
  while (pending.length) {
    const next = pending.pop();
    if (found.has(next) || next === id) continue;
    found.add(next);
    pending.push(...(children.get(next) ?? []));
  }
  return found;
}

/**
 * id → ルートからの経路（候補の見分けに出す）。多親ノードは経路が複数あり、
 * 1 本目だけ出すと、経路で見分けるという目的がいちばん見分けたい相手で
 * 果たせないので、残りは件数で示す。
 */
export function nodePathLabels(root) {
  const labels = {};
  if (!root) return labels;
  const pathsById = {};
  const walk = (treeNode, trail) => {
    const label = trail.join(" / ");
    const seen = (pathsById[treeNode.id] ??= []);
    if (!seen.includes(label)) seen.push(label);
    const nextTrail = [...trail, treeNode.data?.name ?? ""];
    for (const child of treeNode.children ?? []) walk(child, nextTrail);
  };
  walk(root, []);
  for (const [id, paths] of Object.entries(pathsById)) {
    labels[id] = paths.length > 1 ? `${paths[0]} 他 ${paths.length - 1} 件` : (paths[0] ?? "");
  }
  return labels;
}
