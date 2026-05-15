import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function electronDevPlugin() {
  return {
    name: "electron-dev",
    configureServer(server) {
      server.httpServer?.once("listening", () => {
        const electronProcess = spawn("npm", ["run", "start"], {
          env: { ...process.env, VITE_DEV: "true" },
          stdio: "inherit",
          shell: true,
        });
        process.on("exit", () => electronProcess?.kill());
      });
    },
  };
}

export default defineConfig({
  plugins: [svelte(), electronDevPlugin()],
  base: "./",
  publicDir: "public",
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
});
