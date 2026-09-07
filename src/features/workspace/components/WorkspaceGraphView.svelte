<script>
  import { createEventDispatcher } from "svelte";
  export let graph;
  export let selectedId = "";
  const dispatch = createEventDispatcher();
  const W = 1000,
    H = 650,
    RX = 78,
    RY = 30;
  let local = {};
  $: nodes = Object.values(graph?.nodes || {});
  $: edges = nodes.flatMap((n) =>
    (n.parents || []).map((p) => ({ parentId: p.id, childId: n.id }))
  );
  function layout() {
    const depth = new Map([[graph.rootId, 0]]),
      queue = [graph.rootId];
    while (queue.length) {
      const id = queue.shift(),
        d = depth.get(id);
      for (const e of edges.filter((x) => x.parentId === id)) {
        if (!depth.has(e.childId)) {
          depth.set(e.childId, d + 1);
          queue.push(e.childId);
        }
      }
    }
    const groups = new Map();
    for (const n of nodes) {
      const d = depth.get(n.id) ?? Math.max(0, ...depth.values()) + 1;
      groups.set(d, [...(groups.get(d) || []), n]);
    }
    const out = {};
    for (const [d, items] of groups) {
      items.forEach(
        (n, i) =>
          (out[n.id] = {
            x: (W * (i + 1)) / (items.length + 1),
            y: 70 + d * Math.min(130, (H - 120) / Math.max(1, groups.size - 1)),
          })
      );
    }
    return out;
  }
  $: defaults = layout();
  $: positions = Object.fromEntries(
    nodes.map((n) => [n.id, local[n.id] || graph?.positions?.[n.id] || defaults[n.id]])
  );
  function positionFor(id) {
    return (
      positions?.[id] ||
      local[id] ||
      graph?.positions?.[id] ||
      defaults?.[id] || { x: W / 2, y: H / 2 }
    );
  }
  function end(a, b) {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      s = 1 / Math.max(Math.abs(dx) / RX || 0, Math.abs(dy) / RY || 0, 1);
    return { x: b.x - dx * s, y: b.y - dy * s };
  }
  function drag(e, node) {
    if (e.button !== 0) return;
    const svg = e.currentTarget.ownerSVGElement,
      p = svg.createSVGPoint(),
      start = positions[node.id];
    let moved = false;
    const move = (x) => {
      p.x = x.clientX;
      p.y = x.clientY;
      const q = p.matrixTransform(svg.getScreenCTM().inverse()),
        next = { x: Math.max(RX, Math.min(W - RX, q.x)), y: Math.max(RY, Math.min(H - RY, q.y)) };
      if (Math.hypot(next.x - start.x, next.y - start.y) > 2) moved = true;
      local = { ...local, [node.id]: next };
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) return;
      const q = local[node.id] || positions[node.id];
      dispatch("execute", {
        command: { type: "set-position", nodeId: node.id, x: q.x, y: q.y },
        origin: "graph",
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
</script>

<svg
  class="graph"
  viewBox="0 0 1000 650"
  preserveAspectRatio="xMidYMid meet"
  role="img"
  aria-label="Workspace graph"
  ><defs
    ><marker id="workspace-arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto"
      ><path d="M0 0L0 6L9 3z" /></marker
    ></defs
  >
  {#each edges as edge}{@const a = positionFor(edge.parentId)}{@const b = positionFor(
      edge.childId
    )}{@const q = end(a, b)}<line
      x1={a.x}
      y1={a.y}
      x2={q.x}
      y2={q.y}
      marker-end="url(#workspace-arrow)"
    />{/each}
  {#each nodes as node}{@const point = positionFor(node.id)}<g
      transform={`translate(${point.x},${point.y})`}
      class:selected={selectedId === node.id}
      class:archived={node.archived}
      role="button"
      tabindex="0"
      aria-label={node.name}
      on:pointerdown={(e) => drag(e, node)}
      on:click={() => dispatch("select", { nodeId: node.id, parentId: "", occurrenceId: node.id })}
      on:keydown={(e) =>
        (e.key === "Enter" || e.key === " ") &&
        dispatch("select", { nodeId: node.id, parentId: "", occurrenceId: node.id })}
      ><rect x={-RX} y={-RY} width={RX * 2} height={RY * 2} rx="10" /><text
        text-anchor="middle"
        dominant-baseline="middle">{node.name || "名称未設定"}</text
      ></g
    >{/each}
</svg>

<style>
  .graph {
    width: 100%;
    height: 100%;
    min-width: 620px;
    min-height: 460px;
    color: var(--theme-color-Sub-main);
  }
  line {
    stroke: currentColor;
    stroke-width: 2;
    opacity: 0.65;
  }
  marker path {
    fill: var(--theme-color-Sub-main);
  }
  g {
    cursor: grab;
    color: var(--theme-color-Primary-main);
  }
  rect {
    fill: var(--theme-color-Main-main);
    stroke: currentColor;
    stroke-width: 2;
  }
  g.selected rect {
    fill: color-mix(in srgb, var(--theme-color-Primary-main) 18%, var(--theme-color-Main-main));
    stroke-width: 4;
  }
  g.archived {
    opacity: 0.55;
  }
  text {
    fill: var(--theme-color-Sub-light);
    font-size: 13px;
    pointer-events: none;
  }
</style>
