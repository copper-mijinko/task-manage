import { fireEvent, render, screen } from "@testing-library/svelte";
import { vi } from "vitest";

import TaskAttachments from "@features/tasks/components/TaskAttachments.svelte";

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
        isWorkspaceProject: true,
        workspaceProjectDir: "C:\\workspace\\project-1",
        taskId: "task-1",
      },
    });

    expect(screen.getByLabelText("添付なし")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "添付ファイル" })).not.toBeInTheDocument();
  });

  test("renders every attachment in the grid list and keeps the count in sync", () => {
    const attachments = [makeAttachment(1), makeAttachment(2), makeAttachment(3)];
    render(TaskAttachments, {
      props: {
        attachments,
        isWorkspaceProject: true,
        workspaceProjectDir: "C:\\workspace\\project-1",
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
        isWorkspaceProject: true,
        workspaceProjectDir: "C:\\workspace\\project-1",
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
        isWorkspaceProject: true,
        workspaceProjectDir: "C:\\workspace\\project-1",
        taskId: "task-1",
      },
    });

    expect(screen.queryByText("多数の添付")).not.toBeInTheDocument();
  });

  test("opens an attachment when clicked and deletes it after confirmation", async () => {
    const attachment = makeAttachment(1);
    window.electronAPI = {
      wsOpenTaskAttachment: vi.fn().mockResolvedValue({ success: true }),
      wsDeleteTaskAttachment: vi.fn().mockResolvedValue({ success: true, attachments: [] }),
    };
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onAttachmentsChange = vi.fn();

    render(TaskAttachments, {
      props: {
        attachments: [attachment],
        isWorkspaceProject: true,
        workspaceProjectDir: "C:\\workspace\\project-1",
        taskId: "task-1",
        onAttachmentsChange,
      },
    });

    await fireEvent.click(screen.getByTitle("file-1.txt"));
    expect(window.electronAPI.wsOpenTaskAttachment).toHaveBeenCalledWith(
      "C:\\workspace\\project-1",
      "task-1",
      "./attachments/file-1.txt"
    );

    await fireEvent.click(screen.getByRole("button", { name: "添付を削除 file-1.txt" }));

    expect(window.electronAPI.wsDeleteTaskAttachment).toHaveBeenCalledWith(
      "C:\\workspace\\project-1",
      "task-1",
      "./attachments/file-1.txt"
    );
    confirmSpy.mockRestore();
  });

  test("disables interactions when attachments cannot be used", () => {
    render(TaskAttachments, {
      props: {
        attachments: [makeAttachment(1)],
        isWorkspaceProject: false,
        workspaceProjectDir: null,
        taskId: null,
      },
    });

    expect(screen.getByRole("button", { name: "添付を追加" })).toBeDisabled();
    expect(screen.getByTitle("file-1.txt")).toBeDisabled();
    expect(screen.getByRole("button", { name: "添付を削除 file-1.txt" })).toBeDisabled();
  });
});
