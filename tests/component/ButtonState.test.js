import { render } from "@testing-library/svelte";
import { tick } from "svelte";

import Button from "@lib/primitives/Button.svelte";
import IconButton from "@lib/primitives/IconButton.svelte";

describe("button color reactivity", () => {
  test("Button updates theme colors when disabled changes", async () => {
    const { rerender, container } = render(Button, {
      props: {
        content: "rename",
        disabled: true,
        variant: "text",
        normalColor: "var(--theme-color-Info-main)",
        activeColor: "var(--theme-color-Info-dark)",
      },
    });

    expect(container.querySelector("button").getAttribute("style")).toContain("--fontColor: gray");

    await rerender({
      content: "rename",
      disabled: false,
      variant: "text",
      normalColor: "var(--theme-color-Info-main)",
      activeColor: "var(--theme-color-Info-dark)",
    });
    await tick();

    const style = container.querySelector("button").getAttribute("style");
    expect(style).toContain("--fontColor: var(--theme-color-Info-main)");
    expect(style).toContain("--backgroundColor: transparent");
  });

  test("IconButton updates theme colors when disabled changes", async () => {
    const { rerender, container } = render(IconButton, {
      props: {
        disabled: true,
        normalColor: "var(--theme-color-Error-main)",
        activeColor: "var(--theme-color-Error-dark)",
        ariaLabel: "Delete memo",
      },
    });

    // Disabled state: variant shape preserved; visual muting handled by CSS opacity (0.38).
    // Inline CSS variables keep the configured colors so the button still resembles its enabled form.
    const disabledButton = container.querySelector("button");
    expect(disabledButton.disabled).toBe(true);
    expect(disabledButton.getAttribute("style")).toContain("--shadow: none");

    await rerender({
      disabled: false,
      normalColor: "var(--theme-color-Error-main)",
      activeColor: "var(--theme-color-Error-dark)",
      ariaLabel: "Delete memo",
    });
    await tick();

    const style = container.querySelector("button").getAttribute("style");
    expect(style).toContain("--backgroundColor: var(--theme-color-Error-main)");
    expect(style).toContain("--fontColor: var(--theme-color-Main-light)");
  });
});
