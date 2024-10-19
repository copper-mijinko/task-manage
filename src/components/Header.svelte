<script>
  import IconButton from "./IconButton.svelte";
  import Drawer from "./Drawer.svelte";
  import ToggleSwitch from "./ToggleSwitch.svelte";
  import { theme } from "../stores";
  import { THEME_DARK, THEME_LIGHT } from "../common/theme";
  import MenuList from "./MenuList.svelte";
  export let title = "Task Manage";
  let show_drawer = false;
</script>

<Drawer show={show_drawer} toggle={() => {show_drawer = !show_drawer}}>
  <MenuList />
</Drawer>
<div class="Container">
  <IconButton on:click={() => {show_drawer = !show_drawer}} use_ripple={false} activeColor={"transparent"} normalColor={"transparent"} style={"box-shadow: none; height:3rem; width: 3rem"}>
    <svg class="Menu" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M4 6H20M4 12H20M4 18H20" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
  </IconButton>
  <h1 class="Title">{title}</h1>
  <div class="ToggleSwitchContainer">
    <ToggleSwitch left={"Dark"} right={"Light"} leftColor="black" rightColor="white" leftColorBack="rgba(0,0,0,0.5)" rightColorBack="rgba(255,255,255,0.5)" on:click={() => {$theme = $theme==THEME_DARK ? THEME_LIGHT : THEME_DARK}}/>
  </div>
</div>

<style>
  h1.Title {
    margin: 0 1rem;
  }
  .Container {
    display: flex;
    flex-direction: row;
    justify-content: left;
    align-items: center;
		box-shadow: 0 .2rem .5rem rgba(0,0,0,0.25), 0 .1em .25rem rgba(0,0,0,0);
    width: 100%;
    height: 100%;
    background-color: var(--theme-color-Theme-main);
    color: white;
    position: sticky;
    top: 0;
    z-index: 999;
  }
  .Menu {
    flex-shrink: 0;
    flex-grow: 0;
    margin: 1rem;
    height: 100%;
  }
  .Title {
    flex-shrink: 0;
    flex-grow: 0;
    margin: 1rem;
  }
  svg {
    fill: white;
  }
  .ToggleSwitchContainer {
    margin-left: auto;
  }
</style>