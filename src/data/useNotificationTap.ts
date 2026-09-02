/**
 * 網頁版：沒有推播，也就沒有「點通知進來」這件事。
 *
 * 用平台副檔名而不是在函式裡判斷 Platform.OS：expo-notifications 的
 * useLastNotificationResponse 在網頁上底層方法根本不存在，呼叫就丟例外、
 * 整個畫面白掉。它是 hook，不能包在 if 裡跳過，只能讓打包器在 web build 時
 * 拿到一個完全不同的實作。
 */
export function useNotificationTap(): string | null {
  return null;
}
