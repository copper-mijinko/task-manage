<script context="module">
  let dragged_id; // Project ID being dragged
  let dragged_section; // Sidebar project section being dragged
</script>

<script>
  import {
    workspaceApplication,
    workspaceNavigation,
  } from "@features/workspace/application/workspace";
  $: workspaceProjects = $workspaceNavigation?.scopes ?? [];
  import { onMount, afterUpdate, onDestroy } from "svelte";
  import { slide } from "svelte/transition";
  import TaskMenu from "@features/tasks/components/TaskMenu.svelte";
  let projectMenu = null;
  let projectMenuPosition = { x: 0, y: 0, position: "right" };
  let projectMenuTrigger;
  $: projectMenuItems = projectMenu
    ? [
        {
          title: "上に移動",
          action: "up",
          disabled:
            getProjectsForSection(projectMenu.section).findIndex(
              (p) =>
                getProjectId(p, projectMenu.section) ===
                getProjectId(projectMenu.project, projectMenu.section)
            ) <= 0,
        },
        {
          title: "下に移動",
          action: "down",
          disabled: getProjectsForSection(projectMenu.section).at(-1) === projectMenu.project,
        },
        { type: "separator" },
        { title: "プロジェクトを削除", action: "remove", disabled: projectMenu.project.protected },
      ]
    : [];
  function openProjectMenu(event, project, section) {
    event.stopPropagation();
    projectMenuTrigger = event.currentTarget;
    const box = projectMenuTrigger.getBoundingClientRect();
    projectMenuPosition = { x: box.left, y: box.bottom, position: "right" };
    projectMenu = { project, section };
  }
  function closeProjectMenu() {
    projectMenu = null;
    projectMenuTrigger?.focus();
  }
  function moveProjectFromMenu(delta) {
    const { project, section } = projectMenu;
    const projects = [...getProjectsForSection(section)];
    const index = projects.findIndex(
      (p) => getProjectId(p, section) === getProjectId(project, section)
    );
    if (index < 0 || index + delta < 0 || index + delta >= projects.length) return;
    projects.splice(index, 1);
    projects.splice(index + delta, 0, project);
    saveProjectOrder(section, projects);
  }
  function deleteProjectFromMenu() {
    workspace_delete_target = projectMenu.project;
    show_workspace_delete = true;
  }
  import IconButton from "@lib/primitives/IconButton.svelte";
  import Dialog from "@lib/primitives/Dialog.svelte";
  import WorkspaceSetup from "@features/workspace/components/WorkspaceSetup.svelte";
  import { ripple, tooltip } from "@lib/actions";
  import { selected_type, selected_id, sidebarCollapsed } from "@stores";
  import { workspace_store } from "@features/workspace/stores/workspace";
  import { showWorkspaceSetup } from "@stores/ui";

  function selectWorkspaceProject(proj) {
    $selected_type = "WorkspaceProject";
    $selected_id = proj.rootId;
    $sidebarCollapsed = true;
  }

  async function addWorkspaceProject(e) {
    e.stopPropagation();
    workspaceProjectsExpanded = true;
    try {
      const result = await workspaceApplication.createScope(
        $workspace_store.activeWorkspacePath,
        "新しいプロジェクト"
      );
      $selected_type = "WorkspaceProject";
      $selected_id = result.selectedNodeIds[0];
      $sidebarCollapsed = true;
    } catch (e) {
      project_add_error = e.message;
    }
  }

  let workspace_delete_target = null;
  let show_workspace_delete = false;
  const toggle_workspace_delete = () => {
    show_workspace_delete = !show_workspace_delete;
  };
  const callback_workspace_delete = async () => {
    if (!workspace_delete_target) return;
    const target = workspace_delete_target;
    await workspaceApplication.removeScope($workspace_store.activeWorkspacePath, target.rootId);
    if ($selected_type === "WorkspaceProject" && $selected_id === target.rootId) {
      $selected_id = $workspaceNavigation?.rootId;
    }
    workspace_delete_target = null;
  };

  let workspace_open_error = "";
  let project_add_error = "";
  let workspace_open_error_timer;
  let workspaceProjectsExpanded = true;

  async function handleOpenActiveWorkspace(e) {
    e.stopPropagation();
    workspace_open_error = "";
    const result = await workspace_store.openActiveWorkspace();
    if (!result?.success) {
      workspace_open_error = result?.error ?? "Workspaceを開けませんでした";
      if (workspace_open_error_timer) clearTimeout(workspace_open_error_timer);
      workspace_open_error_timer = setTimeout(() => {
        workspace_open_error = "";
      }, 4000);
    }
  }

  // Drag and drop
  let dragOverTarget;
  let dragOverType;
  const reorderSections = new Set(["WorkspaceProject"]);

  function canReorderSection(section) {
    return reorderSections.has(section);
  }

  // Function to get the list of projects
  function getProjectElements() {
    return document.querySelectorAll('.MenuRow[data-section="WorkspaceProject"]');
  }

  function getProjectsForSection() {
    return workspaceProjects ?? [];
  }

  function getProjectId(project) {
    return project.rootId;
  }

  function saveProjectOrder(_section, projects) {
    void workspaceApplication
      .reorderScopes($workspace_store.activeWorkspacePath, projects)
      .catch((e) => (project_add_error = e.message));
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

  onDestroy(() => {
    if (workspace_open_error_timer) clearTimeout(workspace_open_error_timer);
  });

  afterUpdate(() => {
    // Update drag & drop settings when project list changes
    setDND();
  });
</script>

<WorkspaceSetup
  show={$showWorkspaceSetup}
  toggle={() => {
    $showWorkspaceSetup = !$showWorkspaceSetup;
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
        stroke="currentColor"
        stroke-width="2"
        stroke-linejoin="round"
      />
    </svg>
    <span class="TextOverFlow">Workspace</span>
  </div>
  {#if $workspace_store.activeWorkspacePath}
    <button
      class="WorkspaceManageBtn"
      on:click={async () => {
        await workspaceApplication.load($workspace_store.activeWorkspacePath);
        $selected_type = "WorkspaceProject";
        $selected_id = $workspaceNavigation.rootId;
        $sidebarCollapsed = true;
      }}>Workspace Root</button
    >
  {/if}
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
    {#if $workspace_store.activeWorkspacePath}
      <button
        class="WorkspaceIconBtn"
        type="button"
        on:click={handleOpenActiveWorkspace}
        aria-label="Workspaceをファイルエクスプローラーで開く"
        use:tooltip={{
          color: "var(--on-theme-tooltip-fg)",
          backgroundColor: "var(--on-theme-tooltip-bg)",
          content: "Workspaceをファイルエクスプローラーで開く",
          force: true,
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path
            d="M3 7.5C3 6.4 3.9 5.5 5 5.5H9.4L11.2 7.3H19C20.1 7.3 21 8.2 21 9.3V10.5"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M3.4 10.5H20.6L18.8 18.5C18.6 19.4 17.8 20 16.9 20H5.5C4.6 20 3.8 19.4 3.6 18.5L2.3 12C2.1 11.2 2.7 10.5 3.4 10.5Z"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    {/if}
    <button
      class="WorkspaceManageBtn"
      on:click={() => {
        $showWorkspaceSetup = true;
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
  {#if workspace_open_error}
    <div class="WorkspaceOpenError" role="alert">{workspace_open_error}</div>
  {/if}
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
    <span class:TextOverFlow={true}>プロジェクト</span>
  </div>
  <div class="ProjectSubsection" class:Expanded={workspaceProjectsExpanded}>
    <div class="ProjectSubsectionHeader">
      <button
        class="ProjectSubsectionToggle"
        type="button"
        aria-expanded={workspaceProjectsExpanded}
        aria-controls="workspace-project-list"
        aria-label={workspaceProjectsExpanded
          ? "Workspaceプロジェクトを折りたたむ"
          : "Workspaceプロジェクトを展開"}
        use:tooltip={{
          color: "var(--on-theme-tooltip-fg)",
          backgroundColor: "var(--on-theme-tooltip-bg)",
          content:
            "Workspaceフォルダに保存されるプロジェクトです。メモはWorkspaceファイルとして管理されます。",
          force: true,
        }}
        on:click={() => (workspaceProjectsExpanded = !workspaceProjectsExpanded)}
      >
        <svg
          class="Chevron"
          class:Collapsed={!workspaceProjectsExpanded}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M6 9L12 15L18 9"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span class="SubsectionLabel TextOverFlow">Workspace</span>
        <span class="SubsectionCount">{workspaceProjects.length}</span>
      </button>
      <div class="AddButtonContainer">
        {#if $workspace_store.activeWorkspacePath}
          <IconButton
            tooltipContent="Workspaceプロジェクトを追加"
            ariaLabel="Workspaceプロジェクトを追加"
            normalColor="var(--canvas-subtle)"
            activeColor="var(--hover-bg)"
            on:click={addWorkspaceProject}
          >
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
              ><path
                d="M12 5V19M5 12H19"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              ></path></svg
            >
          </IconButton>
        {/if}
      </div>
    </div>
    {#if project_add_error}
      <div class="ProjectAddError" role="alert">{project_add_error}</div>
    {/if}
    {#if workspaceProjectsExpanded}
      <div id="workspace-project-list" class="Contents ProjectContents">
        {#if workspaceProjects.length > 0}
          {#each workspaceProjects as proj (proj.rootId)}
            <div
              class="MenuRow"
              class:Selected={proj.rootId === $selected_id && $selected_type === "WorkspaceProject"}
              data-id={proj.rootId}
              data-section="WorkspaceProject"
            >
              <button
                type="button"
                class="ProjectSelectButton"
                use:ripple
                aria-label={proj.name}
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
              </button>
              <button
                class="ui-action ProjectMenuTrigger"
                aria-label={proj.name + "の操作"}
                data-task-menu-trigger
                on:click={(event) => openProjectMenu(event, proj, "WorkspaceProject")}>…</button
              >
            </div>
          {/each}
        {:else}
          <div class="MenuRow EmptyProjectRow">
            <div class="TreeLine" style="flex-shrink: 0"></div>
            <span class="TextOverFlow">
              {$workspace_store.activeWorkspacePath
                ? "Workspaceプロジェクトなし"
                : "Workspace未設定"}
            </span>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
<Dialog
  show={show_workspace_delete}
  toggle={toggle_workspace_delete}
  header="Workspaceプロジェクトの削除"
  content={`「${workspace_delete_target?.name ?? ""}」のノードと接続を削除します。子ノードは残り、必要ならWorkspace Rootに接続されます。元に戻す操作で復元できます。`}
  ok="削除する"
  danger={true}
  callback={callback_workspace_delete}
/>

<TaskMenu
  show={Boolean(projectMenu)}
  position={projectMenuPosition}
  menuItems={projectMenuItems}
  on:close={closeProjectMenu}
  on:up={() => moveProjectFromMenu(-1)}
  on:down={() => moveProjectFromMenu(1)}
  on:remove={deleteProjectFromMenu}
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
    height: 2.0625rem;
    padding: 0 var(--sp2);
    width: 100%;
    color: var(--fg-default);
    align-items: center;
    font-weight: 600;
    font-size: var(--font-title-sm);
    letter-spacing: 0.04em;
  }
  .Contents {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-height: 13.5rem;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .ProjectSubsection {
    display: flex;
    flex-direction: column;
    flex: 0 0 auto;
    min-height: 0;
    margin: 0 0 var(--sp2);
  }
  .ProjectSubsection.Expanded {
    flex: 0 1 auto;
  }
  .ProjectSubsectionHeader {
    display: flex;
    align-items: center;
    gap: var(--sp1);
    min-height: 1.5rem;
    padding: 0 var(--sp1) 0 var(--sp2);
    color: var(--fg-muted);
    font-size: var(--font-label-md);
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .ProjectSubsectionToggle {
    display: inline-flex;
    align-items: center;
    gap: var(--sp1);
    flex: 1 1 auto;
    min-width: 0;
    min-height: var(--tap-min);
    padding: 0 var(--sp1);
    border-radius: var(--shape-xs);
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    text-align: left;
    cursor: pointer;
  }
  .ProjectSubsectionToggle:hover {
    background-color: var(--hover-bg);
  }
  .ProjectSubsectionToggle:focus-visible {
    outline: 2px solid var(--accent-fg);
    outline-offset: -2px;
  }
  .Chevron {
    width: 0.75rem;
    height: 0.75rem;
    flex-shrink: 0;
    transition: transform 0.12s ease;
  }
  .Chevron.Collapsed {
    transform: rotate(-90deg);
  }
  /* 見出しは「Workspace」「アプリ内」だけにしてある。親セクションが既に
     「プロジェクト」なので、子でも繰り返すと 216px のサイドバー幅に収まらず
     「Workspaceプロジ…」と切れていた。正式名称はツールチップと aria-label
     が持っている。 */
  .SubsectionLabel {
    flex: 0 1 auto;
    min-width: 0;
  }
  .SubsectionCount {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    min-width: 1.0125rem;
    height: 0.825rem;
    margin-left: var(--sp1);
    padding: 0 var(--sp1);
    border-radius: var(--shape-pill);
    color: var(--fg-muted);
    background-color: var(--hover-bg);
    font-size: var(--font-label-sm);
    font-weight: 700;
  }
  .ProjectContents {
    max-height: none;
    overflow-y: visible;
  }
  .Logo {
    width: 0.9375rem;
    height: 0.9375rem;
    fill: currentColor;
    margin-right: var(--sp3);
  }
  .AddButtonContainer {
    margin-left: auto;
    height: 100%;
    aspect-ratio: 1;
  }
  .ProjectMenuTrigger {
    margin-left: auto;
    flex: 0 0 auto;
    /* 実測 13x15。サイドバーで各プロジェクトの操作を開く唯一の入口なので、
       ここが最も小さいのは致命的だった。 */
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--tap-min);
    min-height: var(--tap-min);
  }
  .MenuRow {
    display: flex;
    flex-direction: row;
    box-sizing: border-box;
    position: relative;
    flex: 0 0 1.5rem;
    height: 1.5rem;
    min-height: 1.5rem;
    padding: 0 var(--sp2);
    width: 100%;
    color: var(--fg-default);
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
    outline: 2px solid var(--accent-fg);
    outline-offset: -2px;
    z-index: 1;
  }
  .ProjectSelectButton {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    align-self: stretch;
    min-width: 0;
    min-height: var(--tap-min);
    color: inherit;
    cursor: pointer;
    text-align: left;
  }
  .ProjectSelectButton:focus-visible {
    outline: 2px solid var(--accent-fg);
    outline-offset: -2px;
  }
  .ProjectSelectButton .TextOverFlow {
    flex: 1 1 auto;
    min-width: 0;
  }

  .MenuRow:not(.Selected):hover {
    background-color: var(--hover-bg);
  }
  button {
    border: none;
    padding: 0;
    margin: 0;
    border-radius: 0;
    background-color: transparent;
  }
  .Selected {
    background-color: var(--canvas-subtle);
  }
  .Selected::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    width: 3px;
    height: 100%;
    background-color: var(--accent-fg);
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
    width: 0.75rem;
    border-left: 1px solid var(--border-muted);
    left: -0.75rem;
  }
  /* Drag and drop styles */
  :global(.NameTag) {
    position: absolute;
    top: -750rem;
    display: inline;
    background-color: var(--accent-fg);
    border: 1px solid var(--accent-fg);
    color: var(--fg-default);
    padding: 0 var(--sp2);
    z-index: 10000;
  }

  .MenuRow:global(.Dragging) {
    opacity: 0.6;
  }

  .MenuRow:global(.DragOverTop):before {
    border-top: 0.15rem solid var(--accent-fg);
    position: absolute;
    content: "";
    height: 1.5rem;
    padding: 0;
    width: 100%;
    box-sizing: border-box;
    z-index: 999999;
    pointer-events: none;
  }

  .MenuRow:global(.DragOverBottom):before {
    border-bottom: 0.15rem solid var(--accent-fg);
    position: absolute;
    content: "";
    height: 1.5rem;
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
    min-height: 1.3125rem;
  }
  .WorkspaceName {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--font-body-sm);
    color: var(--fg-muted);
  }
  .NoWorkspaceHint {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--font-body-sm);
    color: var(--fg-muted);
    font-style: italic;
  }
  .WorkspaceIconBtn,
  .WorkspaceManageBtn {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--hover-bg);
    border-radius: var(--shape-xs);
    background-color: var(--hover-bg);
    color: var(--fg-default);
    font-size: var(--font-label-md);
    font-weight: 500;
    cursor: pointer;
    flex-shrink: 0;
    transition:
      background-color 0.12s ease,
      border-color 0.12s ease;
  }
  .WorkspaceIconBtn {
    justify-content: center;
    /* 1.3125rem は html が 75% なので実寸 21px。SC 2.5.8 の 24px を割る。 */
    width: var(--tap-min);
    height: var(--tap-min);
    padding: 0;
  }
  .WorkspaceManageBtn {
    gap: var(--sp1);
    min-height: var(--tap-min);
    padding: 0.15rem var(--sp2);
  }
  .WorkspaceIconBtn:hover,
  .WorkspaceManageBtn:hover {
    background-color: var(--hover-bg);
    border-color: var(--fg-muted);
  }
  .WorkspaceIconBtn svg,
  .WorkspaceManageBtn svg {
    width: 0.675rem;
    height: 0.675rem;
    flex-shrink: 0;
  }
  .WorkspaceOpenError {
    padding: 0 var(--sp2) var(--sp2) var(--sp4);
    color: var(--theme-color-Error-light, #ffb4ab);
    font-size: var(--font-label-md);
  }
  .ProjectAddError {
    padding: 0 var(--sp2) var(--sp2) var(--sp4);
    color: var(--theme-color-Error-light, #ffb4ab);
    font-size: var(--font-label-md);
  }
</style>
