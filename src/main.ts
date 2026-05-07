import { mount } from "svelte";
import App from "./App.svelte";

performance.mark("renderer-start");

const app = mount(App, {
  target: document.getElementById("app")!,
});

export default app;
