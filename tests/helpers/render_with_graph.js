import { render } from "@testing-library/svelte";
import { tick } from "svelte";
import GraphApplicationHarness from "./GraphApplicationHarness.svelte";
import { TEST_WORKSPACE, graphFromTree, installGraphBackend } from "./graph_backend.js";

/**
 * グラフで動くアプリケーションの下にコンポーネントを描く。
 *
 * @param {any} component
 * @param {object} options
 * @param {object} [options.tree] 旧形式の木のフィクスチャ（`graphFromTree` に渡す）
 * @param {object} [options.graph] そのまま使うグラフ（`tree` の代わり）
 * @param {string} [options.scopeId] 開くプロジェクト。既定は木のルート
 * @param {object} [options.props] コンポーネントへ渡す props
 * @param {object} [options.api] `window.electronAPI` に足す／上書きするもの
 */
export async function renderWithGraph(component, options = {}) {
  const graph = options.graph ?? graphFromTree(options.tree);
  const backend = installGraphBackend(graph, options.api);
  const treeRoot = options.tree?.data?.id !== undefined ? options.tree.data : options.tree;
  const scopeId = options.scopeId ?? treeRoot?.id;
  let application;
  const result = render(GraphApplicationHarness, {
    props: {
      component,
      props: options.props ?? {},
      workspacePath: TEST_WORKSPACE,
      scopeId,
      onready: (value) => {
        application = value;
      },
    },
  });
  // グラフの読み込みと最初の描画を待つ。
  for (let i = 0; i < 10 && !application; i++) await new Promise((r) => setTimeout(r, 0));
  await tick();
  await tick();
  return { ...result, backend, application };
}

/** 保存（コマンドの往復）と再描画を待つ。 */
export async function settle() {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await tick();
  }
}
