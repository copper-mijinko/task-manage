import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createIpcSenderValidator,
  createWorkspaceAuthorizer,
  parseAllowedExternalUrl,
  validateWorkspaceConfig,
} from "../../electron/ipc-security.js";

function senderEvent(url, { topLevel = true } = {}) {
  const frame = { url };
  frame.top = topLevel ? frame : { url: "file:///parent.html" };
  return { senderFrame: frame };
}

describe("IPC sender validation", () => {
  const rendererDirectory = path.resolve("renderer");
  const validate = createIpcSenderValidator({
    rendererDirectory,
    devOrigins: ["http://localhost:5173"],
  });

  it("allows only the packaged main and detail documents", () => {
    expect(
      validate(senderEvent(pathToFileURL(path.join(rendererDirectory, "index.html")).href))
    ).toBe(true);
    expect(
      validate(senderEvent(pathToFileURL(path.join(rendererDirectory, "detail.html")).href))
    ).toBe(true);
    expect(
      validate(senderEvent(pathToFileURL(path.join(rendererDirectory, "other.html")).href))
    ).toBe(false);
  });

  it("allows the exact development origin but rejects subframes and other origins", () => {
    expect(validate(senderEvent("http://localhost:5173/detail.html?task=1"))).toBe(true);
    expect(validate(senderEvent("http://localhost:5173/evil.html"))).toBe(false);
    expect(validate(senderEvent("http://localhost:5174/"))).toBe(false);
    expect(validate(senderEvent("http://localhost:5173/", { topLevel: false }))).toBe(false);
  });
});

describe("external URL validation", () => {
  it.each(["https://example.com/path", "http://localhost:5173/"])("allows web URL %s", (url) =>
    expect(parseAllowedExternalUrl(url)).toBe(url)
  );

  it.each([
    "javascript:alert(1)",
    "file:///tmp/private.txt",
    "data:text/html,hello",
    "shell:AppsFolder",
  ])("blocks privileged URL %s", (url) => expect(parseAllowedExternalUrl(url)).toBeNull());
});

describe("workspace path authorization", () => {
  let root;
  let workspaceDir;
  let projectDir;
  let outsideDir;
  let authorizer;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "task-manage-security-"));
    workspaceDir = path.join(root, "workspace");
    projectDir = path.join(workspaceDir, "project-a");
    outsideDir = path.join(root, "outside");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "_project.md"), "---\nid: project-a\n---\n");
    fs.writeFileSync(path.join(outsideDir, "_project.md"), "---\nid: outside\n---\n");
    authorizer = createWorkspaceAuthorizer({ getWorkspacePaths: () => [workspaceDir] });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("accepts a registered workspace and its direct project", async () => {
    await expect(authorizer.assertKnownWorkspace(workspaceDir)).resolves.toBe(
      path.resolve(workspaceDir)
    );
    await expect(authorizer.assertKnownProject(projectDir)).resolves.toBe(path.resolve(projectDir));
  });

  it("rejects outside paths and nested directories as projects", async () => {
    const nestedDir = path.join(projectDir, "task-a");
    fs.mkdirSync(nestedDir);
    fs.writeFileSync(path.join(nestedDir, "_project.md"), "---\nid: nested\n---\n");

    await expect(authorizer.assertKnownProject(outsideDir)).rejects.toThrow(/registered workspace/);
    await expect(authorizer.assertKnownProject(nestedDir)).rejects.toThrow(/direct child/);
  });

  it("confines opened files to registered workspace real paths", async () => {
    const insideFile = path.join(projectDir, "image.png");
    const outsideFile = path.join(outsideDir, "image.png");
    fs.writeFileSync(insideFile, "inside");
    fs.writeFileSync(outsideFile, "outside");

    await expect(authorizer.isInsideKnownWorkspace(insideFile)).resolves.toBe(true);
    await expect(authorizer.isInsideKnownWorkspace(outsideFile)).resolves.toBe(false);
  });
});

describe("workspace configuration validation", () => {
  it("allows existing and picker-approved workspaces", () => {
    const existing = path.resolve("existing-workspace");
    const approved = path.resolve("approved-workspace");
    expect(
      validateWorkspaceConfig({
        config: {
          workspaces: [
            { path: existing, label: "Existing" },
            { path: approved, label: "Approved" },
          ],
          activeWorkspace: approved,
        },
        currentWorkspacePaths: [existing],
        approvedWorkspacePaths: new Set([approved]),
      })
    ).toEqual({
      workspaces: [
        { path: existing, label: "Existing" },
        { path: approved, label: "Approved" },
      ],
      activeWorkspace: approved,
    });
  });

  it("rejects a renderer-invented workspace path", () => {
    expect(() =>
      validateWorkspaceConfig({
        config: { workspaces: [{ path: path.resolve("invented"), label: "No" }] },
        currentWorkspacePaths: [],
        approvedWorkspacePaths: new Set(),
      })
    ).toThrow(/directory picker/);
  });
});
