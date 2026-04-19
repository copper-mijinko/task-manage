import { svelteTesting } from "@testing-library/svelte/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  test: {
    include: ["tests/unit/**/*.test.{js,ts}", "tests/component/**/*.test.{js,ts}"],
    globals: true,
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "http://localhost/",
      },
    },
    setupFiles: ["./tests/setup/vitest.setup.mjs"],
    clearMocks: true,
    restoreMocks: true,
  },
});
