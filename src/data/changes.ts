import { useSyncExternalStore } from 'react';

/**
 * 極簡的變更通知。
 *
 * 任何會改動資料的動作（本地寫入、同步拉取完成）都呼叫 bump()，
 * 畫面用 useDataVersion() 訂閱後重新載入。
 *
 * 為什麼不用 TanStack Query：資料量小、一次全載一個群組，
 * 手動失效反而比快取失效規則更好懂，也少一個相依套件。
 */

let version = 0;
let listeners: (() => void)[] = [];

export function bump(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

const getSnapshot = () => version;

export function useDataVersion(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
