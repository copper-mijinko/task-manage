import { describe, it, expect } from "vitest";
import { electronLaunchArgs, hasDisplay } from "../../scripts/agent-ui-launch.mjs";

describe("electronLaunchArgs", () => {
  it("leaves the arguments untouched for a normal user", () => {
    expect(electronLaunchArgs(["."], { root: false })).toEqual(["."]);
  });

  it("adds --no-sandbox when running as root", () => {
    // Electron refuses to start as root without it, which is what makes
    // `npm run dev:agent` unusable inside root containers.
    expect(electronLaunchArgs(["."], { root: true })).toEqual([".", "--no-sandbox"]);
  });

  it("does not duplicate the flag", () => {
    expect(electronLaunchArgs([".", "--no-sandbox"], { root: true })).toEqual([
      ".",
      "--no-sandbox",
    ]);
  });

  it("does not mutate the passed arguments", () => {
    const args = ["."];
    electronLaunchArgs(args, { root: true });
    expect(args).toEqual(["."]);
  });
});

describe("hasDisplay", () => {
  it("detects X11 and Wayland sessions", () => {
    expect(hasDisplay({ DISPLAY: ":0" })).toBe(true);
    expect(hasDisplay({ WAYLAND_DISPLAY: "wayland-0" })).toBe(true);
    expect(hasDisplay({})).toBe(false);
  });
});
