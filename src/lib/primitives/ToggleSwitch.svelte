<script>
  export let left = "left";
  export let right = "right";
  export let leftColor = "#727de4";
  export let leftColorBack = "#75bbff33";
  export let rightColor = "#ff8d8d";
  export let rightColorBack = "#ff8d8d33";
  export let leftTextColor = null;
  export let rightTextColor = null;
  export let checked = true;
  $: leftTextResolved = leftTextColor ?? leftColor;
  $: rightTextResolved = rightTextColor ?? rightColor;
</script>

<div
  style="--leftColor:{leftColor}; --leftColorBack:{leftColorBack}; --rightColor:{rightColor}; --rightColorBack:{rightColorBack}; --leftTextColor:{leftTextResolved}; --rightTextColor:{rightTextResolved};"
>
  <span class="Left">{left}</span>
  <label class="ToggleButton">
    <input type="checkbox" aria-label={`${left} / ${right}`} {checked} on:click />
  </label>
  <span class="Right">{right}</span>
</div>

<style>
  div {
    display: flex;
    flex-direction: row;
    justify-content: center;
    align-items: center;
    margin: var(--sp2);
  }
  .ToggleButton {
    display: flex;
    align-items: center;
    position: relative;
    width: 4rem;
    height: 2rem;
    border-radius: 2rem;
    box-sizing: content-box;
    background-color: var(--leftColorBack);
    cursor: pointer;
    transition: background-color 0.4s;
  }

  .ToggleButton:has(:checked) {
    background-color: var(--rightColorBack);
  }

  .ToggleButton::before {
    position: absolute;
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    background-color: var(--leftColor);
    content: "";
    left: 0;
    transition: left 0.2s;
  }

  .ToggleButton:has(:checked)::before {
    left: 2rem;
    background-color: var(--rightColor);
  }

  span {
    margin: var(--sp2);
    font-weight: 600;
    font-size: var(--font-label-md);
  }

  .Left {
    color: var(--leftTextColor);
  }

  .Right {
    color: var(--rightTextColor);
  }

  .ToggleButton input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .ToggleButton:has(input:focus-visible) {
    outline: 2px solid var(--accent-fg);
    outline-offset: 3px;
  }
</style>
