import { mount } from "svelte";
import TaskDetailApp from "./TaskDetailApp.svelte";

performance.mark("renderer-start");

const app = mount(TaskDetailApp, {
  target: document.getElementById("app")!,
});

export default app;
