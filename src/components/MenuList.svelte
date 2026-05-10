<script context="module">
  let dragged_id; // Project ID being dragged
</script>

<script>
  import { onMount, afterUpdate } from "svelte";
  import { slide } from "svelte/transition";
  import IconButton from "./IconButton.svelte";
  import Dialog from "./Dialog.svelte";
  import WorkspaceSetup from "./WorkspaceSetup.svelte";
  import { ripple, tooltip } from "../common/common.js";
  import {
    project_ids,
    info_ids,
    selected_type,
    selected_id,
    tag_index,
    active_tag,
  } from "../stores.ts";
  import { workspace_store } from "../stores/workspace";
  import { getDefaultProject } from "../common/tree_control";

  function selectWorkspaceProject(proj) {
    workspace_store.setActiveProject(proj.projectDir);
    $selected_type = "WorkspaceProject";
    $selected_id = proj.rootId;
  }

  async function addWorkspaceProject(e) {
    e.stopPropagation();
    const project = getDefaultProject();
    const result = await workspace_store.createProject(project.data.data.name, project.data.id);
    if (result.success && result.projectDir) {
      workspace_store.setActiveProject(result.projectDir);
      $selected_type = "WorkspaceProject";
      $selected_id = project.data.id;
    }
  }

  let show_workspace_setup = false;
  let tagsExpanded = true;

  // Dialog
  let show_confirm = false;
  let project_id_confirm;
  let project_name_confirm;
  let tagQuery = "";
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
  $: tagEntries = [...$tag_index.entries()].sort(([a], [b]) => a.localeCompare(b));
  $: normalizedTagQuery = tagQuery.trim().toLocaleLowerCase();
  $: visibleTagEntries = normalizedTagQuery
    ? tagEntries.filter(([tag]) => tag.toLocaleLowerCase().includes(normalizedTagQuery))
    : tagEntries;
  $: tagScopeLabel =
    $selected_type === "WorkspaceProject"
      ? "Markdown"
      : $selected_type === "Projects"
        ? "Quill"
        : "Memo";

  // Add
  const handleAdd = (e) => {
    e.stopPropagation();
    project_ids.addProject();
  };
  // Delete
  const handleDelete = (e, project_id) => {
    e.stopPropagation();
    project_id_confirm = project_id;
    project_name_confirm = $project_ids.filter((node, i) => node.id == project_id)[0].name;
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
    const el = e.currentTarget;
    if (el.dataset.section !== "Projects") return;

    el.classList.add("Dragging");

    const name_text = el.querySelector("span").innerText;
    const name_tag = document.createElement("div");
    name_tag.classList.add("NameTag");
    name_tag.innerText = name_text;
    document.body.appendChild(name_tag);

    const rem = parseFloat(window.getComputedStyle(document.documentElement).fontSize);
    e.dataTransfer.setDragImage(name_tag, -rem, -rem);

    dragged_id = el.dataset.id;
  }

  // Drag end
  function dragEnd(e) {
    const el = e.currentTarget;
    dragOverType = undefined;
    dragOverTarget = undefined;
    el.classList.remove("Dragging");
    const nameTag = document.querySelector(".NameTag");
    if (nameTag) nameTag.remove();
  }

  // Drag over
  function dragOver(e) {
    e.preventDefault();
    const el = e.currentTarget;

    // Only the project section can be reordered
    if (el.dataset.section !== "Projects") return;

    // If not the dragging item itself or the currently dragged item
    if (!el.classList.contains("Dragging") && el.dataset.id !== dragged_id) {
      dragOverTarget = el;
      const rect = el.getBoundingClientRect();
      const y = e.clientY;

      if (y <= rect.top + rect.height / 2) {
        if (dragOverType !== "DragOverTop") {
          dragOverType = "DragOverTop";
          el.classList.remove("DragOverBottom");
          el.classList.add("DragOverTop");
        }
      } else if (dragOverType !== "DragOverBottom") {
        dragOverType = "DragOverBottom";
        el.classList.remove("DragOverTop");
        el.classList.add("DragOverBottom");
      }
    }
  }

  // Drag leave
  function dragLeave(e) {
    const el = e.currentTarget;
    dragOverType = undefined;
    el.classList.remove("DragOverTop");
    el.classList.remove("DragOverBottom");
  }

  // Drop
  function dragDrop(e) {
    const el = e.currentTarget;
    if (el.dataset.section !== "Projects" || !dragOverType) return;

    const draggedIndex = $project_ids.findIndex((p) => p.id === dragged_id);
    const targetIndex = $project_ids.findIndex((p) => p.id === el.dataset.id);

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
    el.classList.remove("DragOverTop");
    el.classList.remove("DragOverBottom");
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

<WorkspaceSetup
  show={show_workspace_setup}
  toggle={() => {
    show_workspace_setup = !show_workspace_setup;
  }}
/>

<div class="Container">
  <!-- Workspace section -->
  <br />
  <div class="Section">
    <svg class="Logo" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3 7C3 5.89543 3.89543 5 5 5H9.58579C9.851 5 10.1054 5.10536 10.2929 5.29289L11.7071 6.70711C11.8946 6.89464 12.149 7 12.4142 7H19C20.1046 7 21 7.89543 21 9V17C21 18.1046 20.1046 19 19 19H5C3.89543 19 3 18.1046 3 17V7Z"
        fill="none"
        stroke="white"
        stroke-width="2"
        stroke-linejoin="round"
      />
    </svg>
    <span class="TextOverFlow">Workspace</span>
    <div class="AddButtonContainer">
      {#if $workspace_store.activeWorkspacePath}
        <IconButton
          tooltipContent="Add a workspace project."
          ariaLabel="Add a workspace project"
          normalColor="rgba(255,255,255,0.1)"
          activeColor="rgba(255,255,255,0.2)"
          on:click={addWorkspaceProject}
        >
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
            ><path
              d="M12 5V19M5 12H19"
              stroke="white"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            ></path></svg
          >
        </IconButton>
      {/if}
      <IconButton
        tooltipContent="Manage workspaces"
        ariaLabel="Manage workspaces"
        normalColor="rgba(255,255,255,0.1)"
        activeColor="rgba(255,255,255,0.2)"
        on:click={() => {
          show_workspace_setup = true;
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="3" stroke="white" stroke-width="2" />
          <path
            d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
            stroke="white"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
      </IconButton>
    </div>
  </div>
  <div class="WorkspaceInfo">
    {#if $workspace_store.activeWorkspacePath}
      <span class="WorkspaceName TextOverFlow">
        {$workspace_store.workspaces.find((w) => w.path === $workspace_store.activeWorkspacePath)
          ?.label ??
          $workspace_store.activeWorkspacePath.split(/[/\\]/).pop() ??
          ""}
      </span>
    {:else}
      <button
        class="NoWorkspace"
        on:click={() => {
          show_workspace_setup = true;
        }}
      >
        Set workspace
      </button>
    {/if}
  </div>
  {#if $workspace_store.projects.length > 0}
    <div class="Contents">
      {#each $workspace_store.projects as proj (proj.rootId)}
        <button
          class="MenuRow"
          class:Selected={proj.rootId === $selected_id && $selected_type === "WorkspaceProject"}
          use:ripple
          on:click={() => selectWorkspaceProject(proj)}
        >
          <div class="TreeLine" style="flex-shrink: 0"></div>
          <span
            class="TextOverFlow"
            use:tooltip={{
              color: "var(--theme-color-Main-main)",
              backgroundColor: "var(--theme-color-Sub-main)",
              content: proj.name,
            }}>{proj.name}</span
          >
        </button>
      {/each}
    </div>
  {/if}

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
            <svg class="Logo" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"
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
                ariaLabel="Add a project"
                normalColor="rgba(255,255,255,0.1)"
                activeColor="rgba(255,255,255,0.2)"
                on:click={(e) => {
                  handleAdd(e);
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
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
              class:Selected={child.id == $selected_id && menu.name == $selected_type}
              use:ripple
              data-id={child.id}
              data-section={menu.name}
              on:click={(e) => select(e, child.id, menu.name)}
            >
              <div class:TreeLine={true} style="flex-shrink: 0"></div>
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
                    ariaLabel="Delete the project"
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

  <!-- Tag browser -->
  <div class="TagBrowser">
    <div class="TagHeader">
      <div class="TagTitle">
        <span class="TagLogo">#</span>
        <div class="TagTitleText">
          <span class="TextOverFlow">Tags</span>
          <span class="TagScope">{tagScopeLabel}</span>
        </div>
      </div>
      <button
        class="TagToggle"
        type="button"
        aria-label="Toggle tags section"
        aria-expanded={tagsExpanded}
        on:click={() => (tagsExpanded = !tagsExpanded)}
      >
        {#if tagsExpanded}
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M18 15L12 9L6 15" />
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 9L12 15L18 9" />
          </svg>
        {/if}
      </button>
    </div>
    {#if tagsExpanded}
      <div class="TagContents" transition:slide={{ duration: 100 }}>
        <label class="TagSearch">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 21L16.7 16.7M18 11A7 7 0 1 1 4 11A7 7 0 0 1 18 11Z" />
          </svg>
          <input
            bind:value={tagQuery}
            type="text"
            placeholder="Filter tags"
            aria-label="Filter tags"
          />
        </label>

        {#if visibleTagEntries.length > 0}
          {#each visibleTagEntries as [tag, nodes] (tag)}
            <button
              class="MenuRow TagRow"
              class:Selected={$active_tag === tag}
              use:ripple
              on:click={() => ($active_tag = $active_tag === tag ? null : tag)}
            >
              <span class="TagRowMark">#</span>
              <span class="TextOverFlow">{tag}</span>
              <span class="TagBadge">{nodes.size}</span>
            </button>
          {/each}
        {:else if $tag_index.size > 0}
          <div class="MenuRow EmptyTagRow">
            <span class="TagRowMark">#</span>
            <span class="TextOverFlow">No matches</span>
          </div>
        {:else}
          <div class="MenuRow EmptyTagRow">
            <span class="TagRowMark">#</span>
            <span class="TextOverFlow">No tags</span>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
<Dialog
  show={show_confirm}
  toggle={toggle_confirm}
  header="Confirm."
  content={`Do you really delete "${project_name_confirm}"?`}
  callback={callback_confirm}
/>

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

  .WorkspaceInfo {
    display: flex;
    align-items: center;
    padding: 0 0.5rem 0.5rem 1rem;
    min-height: 1.75rem;
  }
  .WorkspaceName {
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.75);
    max-width: 100%;
  }
  .NoWorkspace {
    font-size: 0.8rem;
    color: var(--theme-color-Accent-main);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    text-align: left;
  }
  .NoWorkspace:hover {
    text-decoration: underline;
  }
  .TagBrowser {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    margin: 0.75rem 0.5rem 0.5rem;
    padding: 0.55rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    background-color: rgba(255, 255, 255, 0.045);
  }
  .TagHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    min-width: 0;
  }
  .TagTitle {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
    color: white;
  }
  .TagLogo,
  .TagRowMark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-weight: 700;
  }
  .TagLogo {
    width: 1.7rem;
    height: 1.7rem;
    border-radius: 8px;
    color: var(--theme-color-Accent-main);
    background-color: rgba(255, 255, 255, 0.08);
    font-size: 1rem;
  }
  .TagTitleText {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
    font-size: 0.86rem;
    font-weight: 700;
  }
  .TagScope {
    color: rgba(255, 255, 255, 0.58);
    font-size: 0.68rem;
    font-weight: 600;
    line-height: 1;
  }
  .TagToggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.9rem;
    height: 1.9rem;
    border: none;
    border-radius: 999px;
    color: rgba(255, 255, 255, 0.76);
    background-color: rgba(255, 255, 255, 0.08);
    cursor: pointer;
    flex-shrink: 0;
  }
  .TagToggle:hover,
  .TagToggle:focus-visible {
    color: white;
    background-color: rgba(255, 255, 255, 0.16);
  }
  .TagToggle svg,
  .TagSearch svg {
    width: 1rem;
    height: 1rem;
  }
  .TagToggle path,
  .TagSearch path {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .TagContents {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    width: 100%;
    max-height: 32%;
    overflow-y: auto;
  }
  .TagSearch {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 2rem;
    margin-bottom: 0.25rem;
    padding: 0 0.55rem;
    border: 1px solid rgba(255, 255, 255, 0.13);
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.58);
    background-color: rgba(0, 0, 0, 0.14);
  }
  .TagSearch:focus-within {
    border-color: var(--theme-color-Accent-main);
    color: white;
    box-shadow: inset 0 0 0 1px var(--theme-color-Accent-main);
  }
  .TagSearch input {
    min-width: 0;
    width: 100%;
    border: none;
    outline: none;
    color: white;
    background: transparent;
    font-size: 0.78rem;
  }
  .TagSearch input::placeholder {
    color: rgba(255, 255, 255, 0.44);
  }
  .TagRow {
    gap: 0.55rem;
    min-height: 2rem;
    padding: 0 0.45rem;
    border-radius: 8px;
  }
  .TagRowMark {
    width: 1.35rem;
    height: 1.35rem;
    border-radius: 999px;
    color: var(--theme-color-Accent-main);
    background-color: rgba(255, 255, 255, 0.07);
    font-size: 0.74rem;
  }
  .EmptyTagRow {
    gap: 0.55rem;
    color: rgba(255, 255, 255, 0.55);
    cursor: default;
  }
  .EmptyTagRow:hover {
    background-color: transparent;
  }
  .EmptyTagRow:hover::before {
    display: none;
  }
  .TagBadge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.45rem;
    height: 1.25rem;
    margin-left: auto;
    padding: 0 0.35rem;
    border-radius: 999px;
    font-size: 0.68rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.7);
    background-color: rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
  }
</style>
