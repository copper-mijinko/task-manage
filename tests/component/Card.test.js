import { render } from "@testing-library/svelte";

import Card from "@lib/primitives/Card.svelte";

describe("Card primitive", () => {
  test("renders no header when title is empty (default)", () => {
    const { container } = render(Card);
    expect(container.querySelector(".CardHeader")).toBeNull();
    expect(container.querySelector(".CardBody")).toBeInTheDocument();
  });

  test("renders a header with the provided title", () => {
    const { container, getByText } = render(Card, { props: { title: "Task Tree" } });

    expect(container.querySelector(".CardHeader")).toBeInTheDocument();
    expect(getByText("Task Tree")).toBeInTheDocument();
  });

  test("CardBody has the `padded` class by default", () => {
    const { container } = render(Card);
    expect(container.querySelector(".CardBody.padded")).toBeInTheDocument();
  });

  test("padded={false} removes the padded class", () => {
    const { container } = render(Card, { props: { padded: false } });
    const body = container.querySelector(".CardBody");
    expect(body).toBeInTheDocument();
    expect(body.classList.contains("padded")).toBe(false);
  });

  test("forwards the `style` prop to the outer Card element", () => {
    const { container } = render(Card, { props: { style: "border: 1px dashed red;" } });
    const outer = container.querySelector(".Card");
    expect(outer.getAttribute("style")).toContain("border: 1px dashed red");
  });
});
