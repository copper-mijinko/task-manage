<script>
  import Select from "./Select.svelte";
  import { tree_data } from "../stores.js";
  import { setNode } from "../common/tree_control.ts";

  export let node;
  export let status = "Open";

  const color_map = {
    Open: "var(--theme-color-Sub-light)",
    "In Progress": "var(--theme-color-Primary-main)",
    Pending: "var(--theme-color-Warning-main)",
    Completed: "var(--theme-color-Success-main)",
    Canceled: "var(--theme-color-Error-main)",
  };

  const changeData = (node, key, value) => {
    node = { ...node, data: { ...node.data, [key]: value } };
    let data = setNode(node, $tree_data.data);
    $tree_data = { ...$tree_data, data: data };
  };
</script>

<div class="StatusContainer">
  {#if status == "Open"}
    <svg
      viewBox="0 0 24 24"
      height="75%"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      ><path
        d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z"
        stroke="var(--theme-color-Sub-light)"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      ></path></svg
    >
  {:else if status == "Pending"}
    <svg
      viewBox="0 0 24 24"
      height="75%"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      ><path
        d="M12 12H12.01M16 12H16.01M8 12H8.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z"
        stroke="var(--theme-color-Warning-main)"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      ></path></svg
    >
  {:else if status == "In Progress"}
    <svg
      viewBox="0 0 24 24"
      height="75%"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      ><path
        d="M12 21C16.9706 21 21 16.9706 21 12H12V3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21Z"
        stroke="var(--theme-color-Primary-main)"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      ></path></svg
    >
  {:else if status == "Completed"}
    <svg
      viewBox="0 0 24 24"
      height="75%"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      ><path
        d="M8 12.3333L10.4615 15L16 9M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z"
        stroke="var(--theme-color-Success-main)"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      ></path></svg
    >
  {:else if status == "Canceled"}
    <svg
      viewBox="0 0 24 24"
      height="75%"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      ><path
        d="M9 9L15 15M15 9L9 15M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z"
        stroke="var(--theme-color-Error-main)"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      ></path></svg
    >
  {/if}
  <Select
    style="height: 1.5rem;"
    backgroundColor="var(--backgroundColor)"
    color={color_map[status]}
    id="status"
    value={status}
    on:change={(e) => {
      changeData(node, "status", e.target.value);
    }}
  >
    <option value="Open">Open</option>
    <option value="Pending">Pending</option>
    <option value="In Progress">In Progress</option>
    <option value="Completed">Completed</option>
    <option value="Canceled">Canceled</option>
  </Select>
</div>

<style>
  .StatusContainer {
    display: flex;
    align-items: center;
    width: 100%;
    height: 100%;
  }
</style>
