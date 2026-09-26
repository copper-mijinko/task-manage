<script>
  /**
   * @typedef {Object} Props
   * @property {string} [left]
   * @property {string} [right]
   * @property {string} [leftColor]
   * @property {string} [leftColorBack]
   * @property {string} [rightColor]
   * @property {string} [rightColorBack]
   * @property {any} [leftTextColor]
   * @property {any} [rightTextColor]
   * @property {boolean} [checked]
   * @property {(detail?: any) => void} [onclick]
   */

  /** @type {Props} */
  let {
    left = "left",
    right = "right",
    leftColor = "#727de4",
    leftColorBack = "#75bbff33",
    rightColor = "#ff8d8d",
    rightColorBack = "#ff8d8d33",
    leftTextColor = null,
    rightTextColor = null,
    checked = true,
    onclick,
  } = $props();
  let leftTextResolved = $derived(leftTextColor ?? leftColor);
  let rightTextResolved = $derived(rightTextColor ?? rightColor);
</script>

<div
  style="--leftColor:{leftColor}; --leftColorBack:{leftColorBack}; --rightColor:{rightColor}; --rightColorBack:{rightColorBack}; --leftTextColor:{leftTextResolved}; --rightTextColor:{rightTextResolved};"
>
  <span class="Left">{left}</span>
  <label class="ToggleButton">
    <input type="checkbox" aria-label={`${left} / ${right}`} {checked} {onclick} />
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
    width: 3rem;
    height: 1.5rem;
    border-radius: 1.5rem;
    box-sizing: content-box;
    background-color: var(--leftColorBack);
    cursor: pointer;
    transition: background-color 0.4s;
  }

  .ToggleButton:has(:global(:checked)) {
    background-color: var(--rightColorBack);
  }

  .ToggleButton::before {
    position: absolute;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    background-color: var(--leftColor);
    content: "";
    left: 0;
    transition: left 0.2s;
  }

  .ToggleButton:has(:global(:checked))::before {
    left: 1.5rem;
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
  .ToggleButton:has(:global(input:focus-visible)) {
    outline: 2px solid var(--accent-fg);
    outline-offset: 3px;
  }
</style>
