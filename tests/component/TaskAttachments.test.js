import { fireEvent, screen } from "@testing-library/svelte";
import { vi } from "vitest";

import TaskAttachments from "@features/tasks/components/TaskAttachments.svelte";
import { applicationStub, renderWithApplicationStub } from "../helpers/application_stub.js";

const render = (component, { props }, application = applicationStub()) =>
  renderWithApplicationStub(component, props, application);

function makeAttachment(index) {
  return {
    id: `./attachments/file-${index}.txt`,
    name: `file-${index}.txt`,
    relativePath: `./attachments/file-${index}.txt`,
    size: 1024,
  };
}

describe("TaskAttachments", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete window.electronAPI;
  });

  test("shows an empty state when there are no attachments", () => {
    render(TaskAttachments, {
      props: {
        attachments: [],
        taskId: "task-1",
      },
    });

    // 0 件のときは件数を繰り返さず、受け口だけを出す。
    expect(screen.queryByRole("list", { name: "添付ファイル" })).not.toBeInTheDocument();
    expect(screen.getByText("この欄にファイルをドロップ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ファイルを選択" })).toBeInTheDocument();
  });

  test("renders every attachment in the grid list and keeps the count in sync", () => {
    const attachments = [makeAttachment(1), makeAttachment(2), makeAttachment(3)];
    render(TaskAttachments, {
      props: {
        attachments,
        taskId: "task-1",
      },
    });

    expect(screen.getByText("3")).toBeInTheDocument();
    for (const attachment of attachments) {
      expect(screen.getByTitle(attachment.name)).toBeInTheDocument();
    }
    // Delete buttons stay in the DOM (revealed via hover/focus in CSS) and remain accessible.
    expect(screen.getByRole("button", { name: "添付を削除 file-1.txt" })).toBeInTheDocument();
  });

  test("shows a dense hint once attachments exceed the threshold", () => {
    const attachments = Array.from({ length: 9 }, (_, i) => makeAttachment(i + 1));
    render(TaskAttachments, {
      props: {
        attachments,
        taskId: "task-1",
      },
    });

    expect(screen.getByText("多数の添付")).toBeInTheDocument();
  });

  test("does not show a dense hint for a small number of attachments", () => {
    const attachments = [makeAttachment(1), makeAttachment(2)];
    render(TaskAttachments, {
      props: {
        attachments,
        taskId: "task-1",
      },
    });

    expect(screen.queryByText("多数の添付")).not.toBeInTheDocument();
  });

  test("opens an attachment when clicked and deletes it after confirmation", async () => {
    const attachment = makeAttachment(1);
    const application = applicationStub({
      openAsset: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue({}),
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      TaskAttachments,
      { props: { attachments: [attachment], taskId: "task-1" } },
      application
    );

    await fireEvent.click(screen.getByTitle("file-1.txt"));
    expect(application.openAsset).toHaveBeenCalledWith("task-1", "./attachments/file-1.txt", false);

    await fireEvent.click(screen.getByRole("button", { name: "添付を削除 file-1.txt" }));

    // 一覧から外すだけで、ファイルは「元に戻す」のために残す。
    expect(application.update).toHaveBeenCalledWith("task-1", { attachments: [] });
    confirmSpy.mockRestore();
  });

  test("disables interactions when attachments cannot be used", () => {
    render(TaskAttachments, {
      props: {
        attachments: [makeAttachment(1)],
        taskId: null,
      },
    });

    expect(screen.getByRole("button", { name: "添付を追加" })).toBeDisabled();
    expect(screen.getByTitle("file-1.txt")).toBeDisabled();
    expect(screen.getByRole("button", { name: "添付を削除 file-1.txt" })).toBeDisabled();
  });
});
