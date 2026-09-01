import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { repository } from './repository';
import { supabase } from './supabase';

/**
 * 即時更新：其他成員記了帳，你的畫面自己會更新，不用手動重整。
 *
 * Supabase 的 postgres_changes 沿用 RLS，所以只會收到自己本來就
 * 讀得到的列——訂閱不會擴大任何人的可見範圍。
 *
 * 收到事件後不直接把內容塞進畫面，而是叫 repository.refresh() 重新
 * 取一次完整資料。事件本身可能亂序、可能漏（斷線期間的變更不會補送），
 * 拿它當「有東西變了」的訊號、真正的內容還是重新查一次，比較不會出錯。
 */

const WATCHED_TABLES = [
  'expenses',
  'expense_payers',
  'expense_splits',
  'transfers',
  'group_members',
  'receipts',
] as const;

/**
 * 訂閱單一群組的變更。
 *
 * 另外補兩個保險，因為即時連線本身並不可靠：
 * - 回到前景／分頁重新可見時重新整理（斷線期間漏掉的事件不會補送）
 * - 連線建立時先整理一次（訂閱之前發生的變更同樣收不到）
 */
export function useGroupRealtime(groupId: string | undefined): void {
  useEffect(() => {
    if (!groupId) return;

    const refresh = () => {
      void repository.refresh();
    };

    // 頻道名稱加上隨機字尾，確保每次都是全新的頻道。
    // supabase.channel(name) 對同名頻道會回傳既有實例，而已經 subscribe()
    // 過的頻道不能再掛 postgres_changes——它會拋出例外。React 嚴格模式
    // 把 effect 跑兩次時就會踩到，然後整頁變成白畫面。
    // 即時更新是加分功能，不是必要條件。訂閱失敗頂多退回「手動重整」，
    // 絕不該讓整個畫面掛掉——先前就因為一個未捕捉的訂閱例外導致整頁空白。
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase.channel(`group:${groupId}:${Math.random().toString(36).slice(2)}`);
      for (const table of WATCHED_TABLES) {
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table, filter: `group_id=eq.${groupId}` },
          refresh,
        );
      }
      channel.subscribe((status) => {
        // 訂閱成功的那一刻先補一次：訂閱之前發生的變更不會被廣播過來
        if (status === 'SUBSCRIBED') refresh();
      });
    } catch {
      channel = null;
      refresh();
    }

    // 回到前景時補一次。斷線期間的事件不會補送，只靠即時連線會漏。
    const appStateSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });

    let removeVisibility: (() => void) | undefined;
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const onVisible = () => {
        if (document.visibilityState === 'visible') refresh();
      };
      document.addEventListener('visibilitychange', onVisible);
      removeVisibility = () => document.removeEventListener('visibilitychange', onVisible);
    }

    return () => {
      if (channel) void supabase.removeChannel(channel);
      appStateSub.remove();
      removeVisibility?.();
    };
  }, [groupId]);
}

/**
 * 群組列表用。這裡只在意「我被加進哪些群組」，
 * 那是 group_members 上跟自己有關的變更（例如朋友把你加進新群組）。
 */
export function useGroupListRealtime(userId: string | undefined): void {
  useEffect(() => {
    if (!userId) return;

    const refresh = () => {
      void repository.refresh();
    };

    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`memberships:${userId}:${Math.random().toString(36).slice(2)}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'group_members', filter: `user_id=eq.${userId}` },
          refresh,
        );
      channel.subscribe();
    } catch {
      channel = null;
    }

    const appStateSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });

    return () => {
      if (channel) void supabase.removeChannel(channel);
      appStateSub.remove();
    };
  }, [userId]);
}
