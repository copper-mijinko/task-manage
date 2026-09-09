import { render, screen, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";
import TagField from "@lib/primitives/TagField.svelte";

test("detail suggestions open on demand and do not accumulate after reopening", async () => {
  const { unmount } = render(TagField, {
    props: { tags: ["build"], suggestions: ["design"], showLabels: false },
  });
  expect(screen.queryByRole("button", { name: "タグ design を追加" })).toBeNull();
  const input = screen.getByRole("textbox");
  await fireEvent.focus(input);
  expect(screen.getAllByRole("button", { name: "タグ design を追加" })).toHaveLength(1);
  await fireEvent.keyDown(document, { key: "Escape" });
  await tick();
  expect(screen.queryByRole("button", { name: "タグ design を追加" })).toBeNull();
  await fireEvent.focus(input);
  expect(screen.getAllByRole("button", { name: "タグ design を追加" })).toHaveLength(1);
  await unmount();
  expect(screen.queryByRole("button", { name: "タグ design を追加" })).toBeNull();
});
