import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { spawn } from "child_process";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8"));

function electronDevPlugin({ agentUi = false } = {}) {
  return {
    name: "electron-dev",
    configureServer(server) {
      server.httpServer?.once("listening", () => {
        const electronEnv = {
          ...process.env,
          VITE_DEV: "true",
          TASK_MANAGE_AGENT_UI: agentUi ? "true" : "false",
        };
        if (agentUi) {
          electronEnv.TASK_MANAGE_CDP_PORT = process.env.TASK_MANAGE_CDP_PORT || "9222";
          electronEnv.TASK_MANAGE_OPEN_DEVTOOLS = "false";
        }

        const electronProcess = spawn("npm", ["run", "start"], {
          env: electronEnv,
          stdio: "inherit",
          shell: true,
        });
        process.on("exit", () => electronProcess?.kill());
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [svelte(), electronDevPlugin({ agentUi: mode === "agent" })],
  base: "./",
  publicDir: "public",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_NAME__: JSON.stringify(pkg.name),
  },
  build: {
    outDir: "renderer",
    emptyOutDir: true,
    target: "esnext",
  },
  resolve: {
    alias: {
      "@lib": path.resolve(__dirname, "src/lib"),
      "@features": path.resolve(__dirname, "src/features"),
      "@pages": path.resolve(__dirname, "src/pages"),
      "@stores": path.resolve(__dirname, "src/stores"),
      "@app-types": path.resolve(__dirname, "src/types"),
    },
  },
}));
