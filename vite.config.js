import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { spawn } from "child_process";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8"));

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
});
