import type { ElectronAPI } from "@app-types/app";

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
