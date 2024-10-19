<script>
  export let is_dark = false;
  export let backgroundColor = "var(--theme-color-Main-light)";
  export let color = "var(--theme-color-Sub-light)";
  export let disabled = false;
  export let value = "";
  export let id = "";
  export let style = "";
  const return_color = (value, default_value) => {
    const days = 5;
    const v = new Date(value);
    const today = new Date();
    if (v - today + 24*60*60*1000 - 1 < 0){
      return 'var(--theme-color-Error-main)';
    }
    if (v - today + 24*60*60*1000 - 1 < 24*60*60*1000*days){
      return 'var(--theme-color-Warning-main)';
    }
    return default_value;
  }
</script>

<div class="Container"  style="--dark:{is_dark? "dark" : ""}; --borderColor: {return_color(value, backgroundColor)}; --color-datetime: {color};">
  <input  {style} class="Date" {id} type="date" {disabled} {value} on:change on:click={(e) => {e.stopPropagation();}} />
</div>

<style>
  .Container {
    display: flex;
    align-items: center;
    width: 100%;
    height: 100%;
  }
  .Date {
    height: 100%;
    width: 100%;
    background-color: var(--backgroundColor);
    color: var(--color-datetime);
    border: .2rem solid var(--borderColor);
    color-scheme: var(--dark);
    position: relative;
    display: flex;
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  .Date::-webkit-calendar-picker-indicator {
    background-color: var(--backgroundColor);
    position: absolute;
    right: 0;
    top: 50%;
    padding-right: .3rem;
    cursor: pointer;
    transform:translateY(-50%) scale(1.25);
    z-index: 999;
  }
</style>
