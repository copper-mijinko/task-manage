import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { spawn } from "child_process";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  electronLaunchArgs,
  ensureVirtualDisplay,
  isPortListening,
} from "./scripts/agent-ui-launch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8"));

function electronDevPlugin({ agentUi = false } = {}) {
  return {
    name: "electron-dev",
    configureServer(server) {
      server.httpServer?.once("listening", async () => {
        const electronEnv = {
          ...process.env,
          VITE_DEV: "true",
          TASK_MANAGE_AGENT_UI: agentUi ? "true" : "false",
        };
        const cdpPort = process.env.TASK_MANAGE_CDP_PORT || "9222";
        if (agentUi) {
          electronEnv.TASK_MANAGE_CDP_PORT = cdpPort;
          electronEnv.TASK_MANAGE_OPEN_DEVTOOLS = "false";

          if (await isPortListening(Number(cdpPort))) {
            // 既存の Agent UI が生きているなら、CDP ポートを奪い合わないよう
            // 二重起動しない（AGENTS.md: 健全なプロセスは再利用する）。
            console.log(
              `[agent-ui] 127.0.0.1:${cdpPort} は既に使用中です。既存の Agent UI を再利用してください（Electron は起動しません）。`
            );
            return;
          }
        }

        // ヘッドレス環境では仮想ディスプレイを用意する。開発起動時のみで、
        // パッケージ版の起動経路には影響しない。
        const virtualDisplay = ensureVirtualDisplay({ log: (message) => console.log(message) });
        if (virtualDisplay) electronEnv.DISPLAY = virtualDisplay;

        // root 実行のコンテナでは Electron が --no-sandbox なしで起動を拒否する。
        // 開発起動に限りフラグを補う（`npm run start` 単体や配布ビルドは通らない）。
        const args = electronLaunchArgs(["."]);
        const electronProcess = spawn("npx", ["electron", ...args], {
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
  server: {
    port: 5173,
    strictPort: true,
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_NAME__: JSON.stringify(pkg.name),
  },
  build: {
    outDir: "renderer",
    emptyOutDir: true,
    target: "esnext",
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        detail: path.resolve(__dirname, "detail.html"),
      },
    },
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
