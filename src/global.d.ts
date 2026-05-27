import type { ElectronAPI } from "@app-types/app";

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }

  const __APP_VERSION__: string;
  const __APP_NAME__: string;
}

export {};
