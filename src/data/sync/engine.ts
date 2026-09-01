import { AppState, type AppStateStatus } from 'react-native';

import { countOutbox, pushOutbox } from './outbox';
import { pullAll } from './pull';

/**
 * 同步引擎：決定「什麼時候」推與拉。
 *
 * 觸發時機：
 * - start() 時立刻跑一輪（App 冷啟動）
 * - App 從背景回到前景
 * - 本地有寫入後（repo 呼叫 kick()）
 * - 失敗後的指數退避重試
 *
 * 單線執行：任何時刻最多一輪同步在跑，重入的請求合併成「跑完再跑一次」。
 */

const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 5 * 60 * 1000;

type Listener = (state: SyncStatus) => void;

export interface SyncStatus {
  running: boolean;
  pendingOutbox: number;
  lastError: string | null;
  lastSyncAt: string | null;
}

let status: SyncStatus = {
  running: false,
  pendingOutbox: 0,
  lastError: null,
  lastSyncAt: null,
};

let listeners: Listener[] = [];
let syncing = false;
let queued = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let failures = 0;
let appStateSub: { remove(): void } | null = null;

function emit(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  for (const listener of listeners) listener(status);
}

export function subscribe(listener: Listener): () => void {
  listeners.push(listener);
  listener(status);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function getStatus(): SyncStatus {
  return status;
}

/** 本地剛寫入了東西，盡快推出去。不等結果。 */
export function kick(): void {
  void runOnce();
}

/**
 * 使用者主動要求更新，等這一輪跑完才回來。
 *
 * 跟 kick() 的差別只在「等不等」。畫面上有刷新鍵時一定要用這個，
 * 否則按下去立刻就顯示「已刷新」，其實資料還在路上。
 */
export async function syncNow(): Promise<void> {
  await runOnce();
}

async function runOnce(): Promise<void> {
  if (syncing) {
    queued = true;
    return;
  }
  syncing = true;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  emit({ running: true });

  try {
    const push = await pushOutbox();
    await pullAll();

    if (push.blocked) {
      // 佇列卡住：資料留著，下一輪退避後再試
      failures += 1;
      scheduleRetry();
      emit({
        pendingOutbox: push.remaining,
        lastError: '部分資料尚未送出，稍後自動重試',
      });
    } else {
      failures = 0;
      emit({
        pendingOutbox: 0,
        lastError: null,
        lastSyncAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    failures += 1;
    scheduleRetry();
    emit({
      pendingOutbox: countOutbox(),
      lastError: err instanceof Error ? err.message : String(err),
    });
  } finally {
    syncing = false;
    emit({ running: false });
    if (queued) {
      queued = false;
      void runOnce();
    }
  }
}

function scheduleRetry(): void {
  const delay = Math.min(BASE_DELAY_MS * 2 ** (failures - 1), MAX_DELAY_MS);
  retryTimer = setTimeout(() => void runOnce(), delay);
}

function onAppStateChange(next: AppStateStatus): void {
  if (next === 'active') {
    void runOnce();
  }
}

/** App 啟動時呼叫一次 */
export function start(): void {
  if (!appStateSub) {
    appStateSub = AppState.addEventListener('change', onAppStateChange);
  }
  emit({ pendingOutbox: countOutbox() });
  void runOnce();
}

export function stop(): void {
  appStateSub?.remove();
  appStateSub = null;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}
