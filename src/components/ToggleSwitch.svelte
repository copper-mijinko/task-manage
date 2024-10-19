<script>
  export let left = "left";
  export let right = "right";
  export let leftColor = "#727de4";
  export let leftColorBack = "#75bbff33";
  export let rightColor = "#ff8d8d";
  export let rightColorBack = "#ff8d8d33";
</script>

<div style="--leftColor:{leftColor}; --leftColorBack:{leftColorBack}; --rightColor:{rightColor}; --rightColorBack:{rightColorBack};">
  <span class="Left">{left}</span>
  <label class="ToggleButton">
    <input type="checkbox" on:click/>
  </label>
  <span class="Right">{right}</span>
</div>

<style>
  div {
    display: flex;
    flex-direction: row;
    justify-content: center;
    align-items: center;
    margin: .5rem
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
    transition: background-color .4s;
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
    content: '';
    left: 0;
    transition: left .2s;
  }

  .ToggleButton:has(:checked)::before {
    left: 2rem;
    background-color: var(--rightColor);
  }

  span {
    margin: .5rem;
    font-weight: 600;
    font-size: .8rem;
  }

  .Left {
    color: var(--leftColor);
  }

  .Right {
    color: var(--rightColor);
  }

  .ToggleButton input {
    display: none;
  }
</style>