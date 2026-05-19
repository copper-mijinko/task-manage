<script context="module">
  let dragged_id; // Project ID being dragged
  let dragged_section; // Sidebar project section being dragged
</script>

<script>
  import { onMount, afterUpdate } from "svelte";
  import { slide } from "svelte/transition";
  import IconButton from "@lib/primitives/IconButton.svelte";
  import Dialog from "@lib/primitives/Dialog.svelte";
  import WorkspaceSetup from "@features/workspace/components/WorkspaceSetup.svelte";
  import { ripple, tooltip } from "@lib/actions";
  import {
    project_ids,
    info_ids,
    selected_type,
    selected_id,
    tag_index,
    active_tag,
  } from "@stores";
  import { workspace_store } from "@features/workspace/stores/workspace";
  import { getDefaultProject } from "@features/tasks/utils/tree_control";

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

  let workspace_delete_target = null;
  let show_workspace_delete = false;
  const toggle_workspace_delete = () => {
    show_workspace_delete = !show_workspace_delete;
  };
  const handleDeleteWorkspaceProject = (e, proj) => {
    e.stopPropagation();
    workspace_delete_target = proj;
    show_workspace_delete = true;
  };
  const callback_workspace_delete = async () => {
    if (!workspace_delete_target) return;
    const target = workspace_delete_target;
    await workspace_store.deleteProject(target.projectDir);
    if ($selected_type === "WorkspaceProject" && $selected_id === target.rootId) {
      $selected_type = undefined;
      $selected_id = undefined;
    }
    workspace_delete_target = null;
  };

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
      ? "Workspace"
      : $selected_type === "Projects"
        ? "db.json"
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
  const reorderSections = new Set(["Projects", "WorkspaceProject"]);

  function canReorderSection(section) {
    return reorderSections.has(section);
  }

  // Function to get the list of projects
  function getProjectElements() {
    return document.querySelectorAll(
      '.MenuRow[data-section="Projects"], .MenuRow[data-section="WorkspaceProject"]'
    );
  }

  function getProjectsForSection(section) {
    return section === "WorkspaceProject"
      ? ($workspace_store.projects ?? [])
      : ($project_ids ?? []);
  }

  function getProjectId(project, section) {
    return section === "WorkspaceProject" ? project.rootId : project.id;
  }

  function saveProjectOrder(section, projects) {
    if (section === "WorkspaceProject") {
      workspace_store.setProjectOrder(projects);
      return;
    }
    project_ids.update(() => projects);
    project_ids.setProjectOrder(projects);
  }

  // Drag start
  function dragStart(e) {
    const el = e.currentTarget;
    if (!canReorderSection(el.dataset.section)) return;

    el.classList.add("Dragging");

    const name_text = el.querySelector("span").innerText;
    const name_tag = document.createElement("div");
    name_tag.classList.add("NameTag");
    name_tag.innerText = name_text;
    document.body.appendChild(name_tag);

    const rem = parseFloat(window.getComputedStyle(document.documentElement).fontSize);
    e.dataTransfer.setDragImage(name_tag, -rem, -rem);

    dragged_id = el.dataset.id;
    dragged_section = el.dataset.section;
  }

  // Drag end
  function dragEnd(e) {
    const el = e.currentTarget;
    dragOverType = undefined;
    dragOverTarget = undefined;
    dragged_id = undefined;
    dragged_section = undefined;
    el.classList.remove("Dragging");
    const nameTag = document.querySelector(".NameTag");
    if (nameTag) nameTag.remove();
  }

  // Drag over
  function dragOver(e) {
    e.preventDefault();
    const el = e.currentTarget;

    if (!canReorderSection(el.dataset.section) || el.dataset.section !== dragged_section) return;

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
    const section = el.dataset.section;
    if (!canReorderSection(section) || section !== dragged_section || !dragOverType) return;

    const projects = getProjectsForSection(section);
    const draggedIndex = projects.findIndex((p) => getProjectId(p, section) === dragged_id);
    const targetIndex = projects.findIndex((p) => getProjectId(p, section) === el.dataset.id);

    if (draggedIndex !== -1 && targetIndex !== -1) {
      // Clone the project array
      const newProjects = [...projects];

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

      saveProjectOrder(section, newProjects);
    }

    // Reset
    el.classList.remove("DragOverTop");
    el.classList.remove("DragOverBottom");
    dragOverType = undefined;
    dragged_id = undefined;
    dragged_section = undefined;
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
      <span class="NoWorkspaceHint TextOverFlow">ワークスペース未設定</span>
    {/if}
    <button
      class="WorkspaceManageBtn"
      on:click={() => {
        show_workspace_setup = true;
      }}
      aria-label="ワークスペースを管理"
    >
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" />
        <path
          d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
      <span>管理</span>
    </button>
  </div>
  <br />
  <div class:Section={true}>
    <svg class="Logo" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" mirror-in-rtl="true"
      ><path
        d="M8 6H5c-.553 0-1-.448-1-1s.447-1 1-1h3c.553 0 1 .448 1 1s-.447 1-1 1zM13 10H5c-.553 0-1-.448-1-1s.447-1 1-1h8c.553 0 1 .448 1 1s-.447 1-1 1zM13 14H5c-.553 0-1-.448-1-1s.447-1 1-1h8c.553 0 1 .448 1 1s-.447 1-1 1z"
      ></path><path
        d="M18 2v8c0 .55-.45 1-1 1s-1-.45-1-1V2.5c0-.28-.22-.5-.5-.5h-13c-.28 0-.5.22-.5.5v19c0 .28.22.5.5.5h13c.28 0 .5-.22.5-.5V21c0-.55.45-1 1-1s1 .45 1 1v1c0 1.1-.9 2-2 2H2c-1.1 0-2-.9-2-2V2C0 .9.9 0 2 0h14c1.1 0 2 .9 2 2z"
      ></path><path
        d="M23.87 11.882c.31.54.045 1.273-.595 1.643l-9.65 5.57c-.084.05-.176.086-.265.11l-2.656.66c-.37.092-.72-.035-.88-.314-.162-.278-.09-.65.17-.913l1.907-1.958c.063-.072.137-.123.214-.167.004-.01.012-.015.012-.015l9.65-5.57c.64-.37 1.408-.234 1.72.305l.374.65z"
      ></path></svg
    >
    <span class:TextOverFlow={true}>Projects</span>
  </div>
  <div class="ProjectSubsection">
    <div class="ProjectSubsectionHeader">
      <span
        class="SubsectionLabel TextOverFlow"
        use:tooltip={{
          color: "var(--on-theme-tooltip-fg)",
          backgroundColor: "var(--on-theme-tooltip-bg)",
          content:
            "Workspaceフォルダに保存されるプロジェクトです。メモはWorkspaceファイルとして管理されます。",
          force: true,
        }}>Workspace Projects</span
      >
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
      </div>
    </div>
    <div class="Contents ProjectContents">
      {#if $workspace_store.projects.length > 0}
        {#each $workspace_store.projects as proj (proj.rootId)}
          <button
            class="MenuRow"
            class:Selected={proj.rootId === $selected_id && $selected_type === "WorkspaceProject"}
            use:ripple
            data-id={proj.rootId}
            data-section="WorkspaceProject"
            on:click={() => selectWorkspaceProject(proj)}
          >
            <div class="TreeLine" style="flex-shrink: 0"></div>
            <span
              class="TextOverFlow"
              use:tooltip={{
                color: "var(--on-theme-tooltip-fg)",
                backgroundColor: "var(--on-theme-tooltip-bg)",
                content: proj.name,
              }}>{proj.name}</span
            >
            <div class="DeleteButtonContainer">
              <IconButton
                tooltipContent="Delete this workspace project."
                ariaLabel="Delete workspace project"
                style="height: 100%; margin:0; box-shadow:none;"
                normalColor="transparent"
                activeColor="rgba(255,255,255,0.2)"
                on:click={(e) => handleDeleteWorkspaceProject(e, proj)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"
                  ><path
                    fill="white"
                    d="M13.05 42q-1.25 0-2.125-.875T10.05 39V10.5H8v-3h9.4V6h13.2v1.5H40v3h-2.05V39q0 1.2-.9 2.1-.9.9-2.1.9Zm21.9-31.5h-21.9V39h21.9Zm-16.6 24.2h3V14.75h-3Zm8.3 0h3V14.75h-3Zm-13.6-24.2V39Z"
                  /></svg
                >
              </IconButton>
            </div>
          </button>
        {/each}
      {:else}
        <div class="MenuRow EmptyProjectRow">
          <div class="TreeLine" style="flex-shrink: 0"></div>
          <span class="TextOverFlow">
            {$workspace_store.activeWorkspacePath ? "No workspace projects" : "Workspace未設定"}
          </span>
        </div>
      {/if}
    </div>
  </div>
  <div class="ProjectSubsection">
    <div class="ProjectSubsectionHeader">
      <span
        class="SubsectionLabel TextOverFlow"
        use:tooltip={{
          color: "var(--on-theme-tooltip-fg)",
          backgroundColor: "var(--on-theme-tooltip-bg)",
          content:
            "従来のdb.jsonに保存されるアプリ内プロジェクトです。db.jsonは将来的に非推奨予定です。",
          force: true,
        }}>InApp Projects (db.json)</span
      >
      <div class="AddButtonContainer">
        <IconButton
          tooltipContent="Add an InApp project."
          ariaLabel="Add an InApp project"
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
    </div>
    <div class="Contents ProjectContents">
      {#each $project_ids as child (child.id)}
        <button
          transition:slide={{ duration: 100 }}
          class:MenuRow={true}
          class:Selected={child.id == $selected_id && $selected_type === "Projects"}
          use:ripple
          data-id={child.id}
          data-section="Projects"
          on:click={(e) => select(e, child.id, "Projects")}
        >
          <div class:TreeLine={true} style="flex-shrink: 0"></div>
          <span
            class:TextOverFlow={true}
            use:tooltip={{
              color: "var(--on-theme-tooltip-fg)",
              backgroundColor: "var(--on-theme-tooltip-bg)",
              content: child.name,
            }}>{child.name}</span
          >
          <div class="DeleteButtonContainer">
            <IconButton
              tooltipContent="Delete the InApp project."
              ariaLabel="Delete the InApp project"
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
        </button>
      {/each}
    </div>
  </div>

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
                  color: "var(--on-theme-tooltip-fg)",
                  backgroundColor: "var(--on-theme-tooltip-bg)",
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

  <!-- Tag browser — laid out exactly like the Workspace/Projects/Info
       sections (logo + title + collapse chevron + .Contents). -->
  <br />
  <div class="Section">
    <svg class="Logo" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M20.59 13.41L13.42 20.58A2 2 0 0 1 10.59 20.58L2 12V2H12L20.59 10.59A2 2 0 0 1 20.59 13.41Z"
        fill="none"
        stroke="white"
        stroke-width="2"
        stroke-linejoin="round"
      />
      <circle cx="7" cy="7" r="1.5" fill="white" />
    </svg>
    <span class="TextOverFlow">Tags <span class="TagScope">({tagScopeLabel})</span></span>
    <div class="AddButtonContainer">
      <IconButton
        tooltipContent={tagsExpanded ? "Tagsを折りたたむ" : "Tagsを展開"}
        ariaLabel="Toggle tags section"
        normalColor="rgba(255,255,255,0.1)"
        activeColor="rgba(255,255,255,0.2)"
        on:click={() => (tagsExpanded = !tagsExpanded)}
      >
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          {#if tagsExpanded}
            <path
              d="M18 15L12 9L6 15"
              stroke="white"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          {:else}
            <path
              d="M6 9L12 15L18 9"
              stroke="white"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          {/if}
        </svg>
      </IconButton>
    </div>
  </div>
  {#if tagsExpanded}
    <div class="Contents TagContents">
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
            <div class="TreeLine" style="flex-shrink: 0"></div>
            <span class="TagRowMark">#</span>
            <span class="TextOverFlow">{tag}</span>
            <span class="TagBadge">{nodes.size}</span>
          </button>
        {/each}
      {:else if $tag_index.size > 0}
        <div class="MenuRow EmptyTagRow">
          <div class="TreeLine" style="flex-shrink: 0"></div>
          <span class="TextOverFlow">No matches</span>
        </div>
      {:else}
        <div class="MenuRow EmptyTagRow">
          <div class="TreeLine" style="flex-shrink: 0"></div>
          <span class="TextOverFlow">No tags</span>
        </div>
      {/if}
    </div>
  {/if}
</div>
<Dialog
  show={show_confirm}
  toggle={toggle_confirm}
  header="Confirm."
  content={`Do you really delete "${project_name_confirm}"?`}
  callback={callback_confirm}
/>
<Dialog
  show={show_workspace_delete}
  toggle={toggle_workspace_delete}
  header="Confirm."
  content={`Do you really delete the workspace project "${workspace_delete_target?.name ?? ""}"?\nThis removes its folder from disk.`}
  callback={callback_workspace_delete}
/>

<style>
  .Container {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .Section {
    display: flex;
    flex-direction: row;
    box-sizing: border-box;
    position: relative;
    height: 2.75rem;
    padding: 0 var(--sp2);
    width: 100%;
    color: white;
    align-items: center;
    font-weight: 600;
    font-size: var(--font-title-sm);
    letter-spacing: 0.04em;
  }
  .Contents {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-height: 18rem;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .ProjectSubsection {
    display: flex;
    flex-direction: column;
    min-height: 0;
    margin: 0 0 var(--sp2);
  }
  .ProjectSubsectionHeader {
    display: flex;
    align-items: center;
    min-height: 2rem;
    padding: 0 var(--sp2) 0 var(--sp3);
    color: rgba(255, 255, 255, 0.78);
    font-size: var(--font-label-md);
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .SubsectionLabel {
    min-width: 0;
    cursor: help;
  }
  .ProjectContents {
    max-height: 12rem;
  }
  .Logo {
    width: 1.25rem;
    height: 1.25rem;
    fill: white;
    margin-right: var(--sp3);
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
    flex: 0 0 2rem;
    height: 2rem;
    min-height: 2rem;
    padding: 0 var(--sp2);
    width: 100%;
    color: white;
    align-items: center;
    cursor: pointer;
    border-radius: 0 var(--shape-sm) var(--shape-sm) 0;
    font-size: var(--font-body-sm);
    overflow: hidden;
  }
  span {
    display: block;
  }
  .MenuRow:focus-visible {
    outline: 2px solid var(--on-theme-primary);
    outline-offset: -2px;
    z-index: 1;
  }
  .MenuRow:not(.Selected):hover {
    background-color: rgba(255, 255, 255, 0.08);
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
    left: 0;
    width: 3px;
    height: 100%;
    background-color: var(--on-theme-primary);
    z-index: 99999;
  }
  .TextOverFlow {
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }
  .TreeLine {
    display: block;
    align-self: stretch;
    height: auto;
    width: 1rem;
    border-left: 1px solid white;
    left: -1rem;
  }
  /* Drag and drop styles */
  :global(.NameTag) {
    position: absolute;
    top: -1000rem;
    display: inline;
    background-color: var(--on-theme-primary);
    border: 1px solid var(--on-theme-primary);
    color: #ffffff;
    padding: 0 var(--sp2);
    z-index: 10000;
  }

  .MenuRow:global(.Dragging) {
    opacity: 0.6;
  }

  .MenuRow:global(.DragOverTop):before {
    border-top: 0.2rem solid var(--on-theme-primary);
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
    border-bottom: 0.2rem solid var(--on-theme-primary);
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
    gap: var(--sp2);
    padding: 0 var(--sp2) var(--sp2) var(--sp4);
    min-height: 1.75rem;
  }
  .WorkspaceName {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--font-body-sm);
    color: rgba(255, 255, 255, 0.75);
  }
  .NoWorkspaceHint {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--font-body-sm);
    color: rgba(255, 255, 255, 0.5);
    font-style: italic;
  }
  .WorkspaceManageBtn {
    display: inline-flex;
    align-items: center;
    gap: var(--sp1);
    padding: 0.2rem var(--sp2);
    border: 1px solid rgba(255, 255, 255, 0.32);
    border-radius: var(--shape-xs);
    background-color: rgba(255, 255, 255, 0.08);
    color: white;
    font-size: var(--font-label-md);
    font-weight: 500;
    cursor: pointer;
    flex-shrink: 0;
    transition:
      background-color 0.12s ease,
      border-color 0.12s ease;
  }
  .WorkspaceManageBtn:hover {
    background-color: rgba(255, 255, 255, 0.18);
    border-color: rgba(255, 255, 255, 0.5);
  }
  .WorkspaceManageBtn svg {
    width: 0.9rem;
    height: 0.9rem;
    flex-shrink: 0;
  }
  .TagRowMark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-weight: 700;
  }
  .TagScope {
    color: rgba(255, 255, 255, 0.6);
    font-size: var(--font-label-sm);
    font-weight: 400;
    letter-spacing: 0;
    margin-left: 4px;
  }
  .TagSearch svg {
    width: 1rem;
    height: 1rem;
  }
  .TagSearch path {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .TagContents {
    flex: 1 1 auto;
    min-height: 6rem;
  }
  .TagSearch {
    display: flex;
    align-items: center;
    gap: var(--sp1);
    min-height: 2rem;
    margin: 0 var(--sp2) var(--sp1);
    padding: 0 var(--sp2);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: var(--shape-sm);
    color: rgba(255, 255, 255, 0.58);
    background-color: rgba(0, 0, 0, 0.14);
    flex-shrink: 0;
  }
  .TagSearch:focus-within {
    border-color: var(--on-theme-primary);
    color: white;
    box-shadow: inset 0 0 0 1px var(--on-theme-primary);
  }
  .TagSearch input {
    min-width: 0;
    width: 100%;
    border: none;
    outline: none;
    color: white;
    background: transparent;
    font-size: var(--font-body-sm);
  }
  .TagSearch input::placeholder {
    color: rgba(255, 255, 255, 0.44);
  }
  .TagRow {
    gap: var(--sp2);
    min-height: 2rem;
    padding: 0 var(--sp2);
    border-radius: var(--shape-sm);
  }
  .TagRowMark {
    width: 1.25rem;
    height: 1.25rem;
    border-radius: var(--shape-pill);
    color: var(--on-theme-primary);
    background-color: rgba(255, 255, 255, 0.07);
    font-size: var(--font-label-md);
  }
  .EmptyTagRow {
    gap: var(--sp2);
    color: rgba(255, 255, 255, 0.55);
    cursor: default;
  }
  .EmptyProjectRow {
    gap: var(--sp2);
    color: rgba(255, 255, 255, 0.55);
    cursor: default;
  }
  .EmptyProjectRow:hover {
    background-color: transparent;
  }
  .EmptyProjectRow:hover::before {
    display: none;
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
    min-width: 1.5rem;
    height: 1.25rem;
    margin-left: auto;
    padding: 0 var(--sp1);
    border-radius: var(--shape-pill);
    font-size: var(--font-label-sm);
    font-weight: 700;
    color: rgba(255, 255, 255, 0.7);
    background-color: rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
  }
</style>
