import { render } from "@testing-library/svelte";
import { vi } from "vitest";

import BulkActionBar from "@features/tasks/components/BulkActionBar.svelte";

describe("BulkActionBar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  test("stays hidden for a single selected task", () => {
    render(BulkActionBar, { props: { count: 1 } });

    expect(document.querySelector(".BulkBar")).not.toBeInTheDocument();
  });

  test("shows for multiple selected tasks", () => {
    render(BulkActionBar, { props: { count: 2 } });

    expect(document.querySelector(".BulkBar")).toBeInTheDocument();
  });
});
