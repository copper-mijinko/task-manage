import { render } from "@testing-library/svelte";
import { get } from "svelte/store";
import { tick } from "svelte";

import GanttPanel from "../../src/components/GanttPanel.svelte";
import {
  closed_node_ids,
  filtered_data,
  ganttScale,
  ganttScrollTop,
  tree_data,
} from "../../src/stores.ts";

function createProjectData() {
  return {
    headers: [
      { name: "name", default_ratio: 10 },
      { name: "status", default_ratio: 4 },
      { name: "start date", default_ratio: 4 },
      { name: "due date", default_ratio: 4 },
      { name: "memo", default_ratio: 2 },
    ],
    data: {
      id: "project-1",
      data: {
        name: "Sample Project",
        status: "Open",
        "start date": undefined,
        "due date": undefined,
        memo: [],
      },
      children: [
        {
          id: "task-1",
          data: {
            name: "First Task",
            status: "Open",
            "start date": undefined,
            "due date": undefined,
            memo: [],
          },
          children: [],
        },
      ],
    },
  };
}

function mockTimelineViewport(container) {
  const body = container.querySelector(".GanttBody");
  Object.defineProperty(body, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      left: 0,
      right: 600,
      top: 0,
      bottom: 200,
      width: 600,
      height: 200,
    }),
  });
}

function dispatchPointerEvent(target, type, options) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    button: { value: options.button ?? 0 },
    clientX: { value: options.clientX },
    pointerId: { value: options.pointerId ?? 1 },
  });
  target.dispatchEvent(event);
}

describe("GanttPanel", () => {
  beforeEach(() => {
    const projectData = createProjectData();

    tree_data.set(projectData);
    filtered_data.set(projectData.data);
    closed_node_ids.set(new Set());
    ganttScale.set("day");
    ganttScrollTop.set(0);
  });

  test("shows a translucent create preview while dragging a new range", async () => {
    const { container } = render(GanttPanel);
    mockTimelineViewport(container);

    const row = container.querySelector('[data-row-id="task-1"]');

    dispatchPointerEvent(row, "pointerdown", { button: 0, clientX: 100 });
    dispatchPointerEvent(document, "pointermove", { clientX: 220 });
    await tick();

    expect(container.querySelector(".CreatePreview")).toBeInTheDocument();
    expect(get(tree_data).data.children[0].data["start date"]).toBeUndefined();

    dispatchPointerEvent(document, "pointerup", { clientX: 220 });
    await tick();

    expect(container.querySelector(".CreatePreview")).not.toBeInTheDocument();
    expect(get(tree_data).data.children[0].data["start date"]).toBeDefined();
    expect(get(tree_data).data.children[0].data["due date"]).toBeDefined();
  });
});
