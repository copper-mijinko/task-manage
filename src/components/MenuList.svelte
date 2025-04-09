<script context="module">
  let dragged_id; // Project ID being dragged
</script>

<script>
  import { onMount, afterUpdate } from "svelte";
  import { slide } from "svelte/transition";
  import IconButton from "./IconButton.svelte";
  import Dialog from "./Dialog.svelte";
  import { ripple, tooltip } from "../common/common.js";
  import {
    project_ids,
    info_ids,
    selected_type,
    selected_id,
  } from "../stores.js";

  // Dialog
  let show_confirm = false;
  let project_id_confirm;
  let project_name_confirm;
  const toggle_confirm = () => {
    show_confirm = !show_confirm;
  };
  const callback_confirm = () => {
    project_ids.deleteProject(project_id_confirm);
  };

  function select(e, id, section) {
    e.stopPropagation();
    $selected_type = section;
    $selected_id = id;
  }
  $: menu_data = [
    {
      name: "Projects",
      children: $project_ids,
    },
    {
      name: "Info",
      children: $info_ids,
    },
  ];

  // Add
  const handleAdd = (e) => {
    e.stopPropagation();
    project_ids.addProject();
  };
  // Delete
  const handleDelete = (e, project_id) => {
    e.stopPropagation();
    project_id_confirm = project_id;
    project_name_confirm = $project_ids.filter(
      (node, i) => node.id == project_id,
    )[0].name;
    show_confirm = true;
  };

  // Drag and drop
  let dragOverTarget;
  let dragOverType;

  // Function to get the list of projects
  function getProjectElements() {
    return document.querySelectorAll('.MenuRow[data-section="Projects"]');
  }

  // Drag start
  function dragStart(e) {
    if (e.currentTarget.dataset.section !== "Projects") return;

    this.classList.add("Dragging");

    const name_text = this.querySelector("span").innerText;
    const name_tag = document.createElement("div");
    name_tag.classList.add("NameTag");
    name_tag.innerText = name_text;
    document.body.appendChild(name_tag);

    const rem = parseFloat(
      window.getComputedStyle(document.documentElement).fontSize,
    );
    e.dataTransfer.setDragImage(name_tag, -rem, -rem);

    dragged_id = e.currentTarget.dataset.id;
  }

  // Drag end
  function dragEnd() {
    dragOverType = undefined;
    dragOverTarget = undefined;
    this.classList.remove("Dragging");
    const nameTag = document.querySelector(".NameTag");
    if (nameTag) nameTag.remove();
  }

  // Drag over
  function dragOver(e) {
    e.preventDefault();

    // Only the project section can be reordered
    if (this.dataset.section !== "Projects") return;

    // If not the dragging item itself or the currently dragged item
    if (
      !this.classList.contains("Dragging") &&
      this.dataset.id !== dragged_id
    ) {
      dragOverTarget = this;
      const rect = this.getBoundingClientRect();
      const y = e.clientY;

      if (y <= rect.top + rect.height / 2) {
        if (dragOverType !== "DragOverTop") {
          dragOverType = "DragOverTop";
          this.classList.remove("DragOverBottom");
          this.classList.add("DragOverTop");
        }
      } else if (dragOverType !== "DragOverBottom") {
        dragOverType = "DragOverBottom";
        this.classList.remove("DragOverTop");
        this.classList.add("DragOverBottom");
      }
    }
  }

  // Drag leave
  function dragLeave() {
    dragOverType = undefined;
    this.classList.remove("DragOverTop");
    this.classList.remove("DragOverBottom");
  }

  // Drop
  function dragDrop() {
    if (this.dataset.section !== "Projects" || !dragOverType) return;

    const draggedIndex = $project_ids.findIndex((p) => p.id === dragged_id);
    const targetIndex = $project_ids.findIndex((p) => p.id === this.dataset.id);

    if (draggedIndex !== -1 && targetIndex !== -1) {
      // Clone the project array
      const newProjects = [...$project_ids];

      // Remove the dragged item
      const [draggedProject] = newProjects.splice(draggedIndex, 1);

      // Calculate insertion position (before if DragOverTop, after if DragOverBottom)
      let insertAt = targetIndex;
      if (dragOverType === "DragOverBottom") {
        insertAt = targetIndex + (draggedIndex < targetIndex ? 0 : 1);
      } else {
        insertAt = targetIndex + (draggedIndex < targetIndex ? -1 : 0);
      }

      // Reinsert into the array
      newProjects.splice(Math.max(0, insertAt), 0, draggedProject);

      // Update the store
      project_ids.update(() => newProjects);

      // Save the new order to backend
      project_ids.setProjectOrder(newProjects);
    }

    // Reset
    this.classList.remove("DragOverTop");
    this.classList.remove("DragOverBottom");
    dragOverType = undefined;
    dragged_id = undefined;
  }

  // Add cleanup function to prevent duplicate event listeners
  function cleanupDND(element) {
    element.removeEventListener("dragstart", dragStart);
    element.removeEventListener("dragend", dragEnd);
    element.removeEventListener("dragover", dragOver);
    element.removeEventListener("dragleave", dragLeave);
    element.removeEventListener("drop", dragDrop);
  }

  // Setup drag & drop events
  function setDND() {
    const projectItems = getProjectElements();

    projectItems.forEach((item) => {
      // First remove existing event listeners
      cleanupDND(item);

      // For the dragging side
      item.setAttribute("draggable", "true");
      item.addEventListener("dragstart", dragStart);
      item.addEventListener("dragend", dragEnd);

      // For the drop target side
      item.addEventListener("dragover", dragOver);
      item.addEventListener("dragleave", dragLeave);
      item.addEventListener("drop", dragDrop);
    });
  }

  onMount(() => {
    // Initial drag & drop setup
    setDND();
  });

  afterUpdate(() => {
    // Update drag & drop settings when project list changes
    setDND();
  });
</script>

<div class="Container">
  {#if menu_data}
    {#each menu_data as menu, i}
      {#if menu.children}
        <br />
        <div class:Section={true}>
          {#if menu.name == "Projects"}
            <svg
              class="Logo"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
              mirror-in-rtl="true"
              ><path
                d="M8 6H5c-.553 0-1-.448-1-1s.447-1 1-1h3c.553 0 1 .448 1 1s-.447 1-1 1zM13 10H5c-.553 0-1-.448-1-1s.447-1 1-1h8c.553 0 1 .448 1 1s-.447 1-1 1zM13 14H5c-.553 0-1-.448-1-1s.447-1 1-1h8c.553 0 1 .448 1 1s-.447 1-1 1z"
              ></path><path
                d="M18 2v8c0 .55-.45 1-1 1s-1-.45-1-1V2.5c0-.28-.22-.5-.5-.5h-13c-.28 0-.5.22-.5.5v19c0 .28.22.5.5.5h13c.28 0 .5-.22.5-.5V21c0-.55.45-1 1-1s1 .45 1 1v1c0 1.1-.9 2-2 2H2c-1.1 0-2-.9-2-2V2C0 .9.9 0 2 0h14c1.1 0 2 .9 2 2z"
              ></path><path
                d="M23.87 11.882c.31.54.045 1.273-.595 1.643l-9.65 5.57c-.084.05-.176.086-.265.11l-2.656.66c-.37.092-.72-.035-.88-.314-.162-.278-.09-.65.17-.913l1.907-1.958c.063-.072.137-.123.214-.167.004-.01.012-.015.012-.015l9.65-5.57c.64-.37 1.408-.234 1.72.305l.374.65z"
              ></path></svg
            >
          {/if}
          {#if menu.name == "Info"}
            <svg
              class="Logo"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
              ><path
                d="M12 18.5C12.5523 18.5 13 18.0523 13 17.5L13 10.5C13 9.94772 12.5523 9.5 12 9.5C11.4477 9.5 11 9.94772 11 10.5L11 17.5C11 18.0523 11.4477 18.5 12 18.5Z"
              ></path><path
                d="M12 8.5C12.8284 8.5 13.5 7.82843 13.5 7C13.5 6.17157 12.8284 5.5 12 5.5C11.1716 5.5 10.5 6.17157 10.5 7C10.5 7.82843 11.1716 8.5 12 8.5Z"
              ></path><path
                fill-rule="evenodd"
                clip-rule="evenodd"
                d="M1 12C1 18.0751 5.92487 23 12 23C18.0751 23 23 18.0751 23 12C23 5.92487 18.0751 1 12 1C5.92487 1 1 5.92487 1 12ZM12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12C21 16.9706 16.9706 21 12 21Z"
              ></path></svg
            >
          {/if}
          <span class:TextOverFlow={true}>
            {menu.name}
          </span>
          {#if menu.name == "Projects"}
            <div class="AddButtonContainer">
              <IconButton
                tooltipContent="Add a project."
                normalColor="rgba(255,255,255,0.1)"
                activeColor="rgba(255,255,255,0.2)"
                on:click={(e) => {
                  handleAdd(e);
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  ><path
                    d="M12 5V19M5 12H19"
                    stroke="white"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  ></path></svg
                >
              </IconButton>
            </div>
          {/if}
        </div>
        <div class="Contents">
          {#each menu.children as child, i}
            <button
              transition:slide={{ duration: 100 }}
              class:MenuRow={true}
              class:Selected={child.id == $selected_id}
              use:ripple
              data-id={child.id}
              data-section={menu.name}
              on:click={(e) => select(e, child.id, menu.name)}
            >
              <div class:TreeLine={true} style="flex-shrink: 0" />
              <span
                class:TextOverFlow={true}
                use:tooltip={{
                  color: "var(--theme-color-Main-main)",
                  backgroundColor: "var(--theme-color-Sub-main)",
                  content: child.name,
                }}>{child.name}</span
              >
              {#if menu.name == "Projects"}
                <div class="DeleteButtonContainer">
                  <IconButton
                    tooltipContent="Delete the project."
                    style="height: 100%; margin:0; box-shadow:none;"
                    normalColor="transparent"
                    activeColor="rgba(255,255,255,0.2)"
                    on:click={(e) => {
                      handleDelete(e, child.id);
                    }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"
                      ><path
                        fill="white"
                        d="M13.05 42q-1.25 0-2.125-.875T10.05 39V10.5H8v-3h9.4V6h13.2v1.5H40v3h-2.05V39q0 1.2-.9 2.1-.9.9-2.1.9Zm21.9-31.5h-21.9V39h21.9Zm-16.6 24.2h3V14.75h-3Zm8.3 0h3V14.75h-3Zm-13.6-24.2V39Z"
                      /></svg
                    >
                  </IconButton>
                </div>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    {/each}
  {:else}
    <p style="color: white;">loading...</p>
  {/if}
</div>
<body style="width: 100%; height: 100%;">
  <Dialog
    show={show_confirm}
    toggle={toggle_confirm}
    header="Confirm."
    content={`Do you really delete "${project_name_confirm}"?`}
    callback={callback_confirm}
  />
</body>

<style>
  .Container {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
  }
  .Section {
    display: flex;
    flex-direction: row;
    box-sizing: border-box;
    position: relative;
    height: 3rem;
    padding: 0;
    width: 100%;
    color: white;
    align-items: center;
    font-weight: bold;
  }
  .Contents {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-height: 50%;
    overflow: auto;
  }
  .Logo {
    width: 1.5rem;
    height: 1.5rem;
    fill: white;
    margin-right: 1rem;
  }
  .AddButtonContainer {
    margin-left: auto;
    height: 100%;
    aspect-ratio: 1;
  }
  .DeleteButtonContainer {
    margin-left: auto;
    height: 100%;
    aspect-ratio: 1;
  }
  .MenuRow {
    display: flex;
    flex-direction: row;
    box-sizing: border-box;
    position: relative;
    height: 2rem;
    padding: 0;
    width: 100%;
    color: white;
    align-items: center;
    cursor: pointer;
    border-radius: 0rem 0.5rem 0.5rem 0rem;
  }
  span {
    display: block;
  }
  .MenuRow:hover {
    background-color: var(--theme-color-Theme-dark);
  }
  .MenuRow:hover::before {
    content: "";
    position: absolute;
    top: 0;
    width: 0.2rem;
    height: 100%;
    background-color: var(--theme-color-Accent-dark);
    z-index: 99999;
  }
  button {
    border: none;
    padding: 0;
    margin: 0;
    border-radius: 0;
    background-color: transparent;
  }
  .Selected {
    background-color: var(--theme-color-Theme-dark);
  }
  .Selected::before {
    content: "";
    position: absolute;
    top: 0;
    width: 0.2rem;
    height: 100%;
    background-color: var(--theme-color-Accent-dark);
    z-index: 99999;
  }
  .TextOverFlow {
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }

  .SortHelper {
    font-size: 0.75rem;
    opacity: 0.7;
    font-weight: normal;
    margin-left: 0.5rem;
  }
  .TreeLine {
    display: block;
    height: 100%;
    width: 1rem;
    border-left: 1px solid white;
    left: -1rem;
  }

  /* Drag and drop styles */
  :global(.NameTag) {
    position: absolute;
    top: -1000rem;
    display: inline;
    background-color: var(--theme-color-Accent-dark);
    border: 1px solid var(--theme-color-Accent-dark);
    color: var(--theme-color-Sub-main);
    padding: 0 0.5rem;
    z-index: 10000;
  }

  .MenuRow:global(.Dragging) {
    opacity: 0.6;
  }

  .MenuRow:global(.DragOverTop):before {
    border-top: 0.2rem solid var(--theme-color-Accent-dark);
    position: absolute;
    content: "";
    height: 2rem;
    padding: 0;
    width: 100%;
    box-sizing: border-box;
    z-index: 999999;
    pointer-events: none;
  }

  .MenuRow:global(.DragOverBottom):before {
    border-bottom: 0.2rem solid var(--theme-color-Accent-dark);
    position: absolute;
    content: "";
    height: 2rem;
    padding: 0;
    width: 100%;
    box-sizing: border-box;
    z-index: 999999;
    pointer-events: none;
  }
</style>
