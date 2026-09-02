import * as Notifications from 'expo-notifications';

/**
 * 原生端：回傳「使用者剛才點的那則通知要跳到哪個群組」，沒有就是 null。
 *
 * 用 useLastNotificationResponse 而不是監聽事件：App 完全沒在跑的時候點通知啟動，
 * 事件在畫面掛載之前就發生了，監聽器會錯過；這個 hook 會把「啟動的原因」補給你。
 */
export function useNotificationTap(): string | null {
  const response = Notifications.useLastNotificationResponse();
  const data = response?.notification.request.content.data as { groupId?: string } | undefined;
  return data?.groupId ?? null;
}
