import type { ElectronAPI } from "./types/app";

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
