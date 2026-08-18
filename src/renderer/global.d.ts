import type { OnlyApi } from '@shared/ipc';

declare global {
  interface Window {
    only: OnlyApi;
  }
}

export {};
