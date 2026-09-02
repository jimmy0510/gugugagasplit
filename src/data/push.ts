import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from './supabase';

/**
 * 推播通知的用戶端部分：要權限、拿裝置位址、存到伺服器。
 *
 * 訊息由誰送？資料庫。支出或還款一寫進伺服器，觸發器就叫 Edge Function 派送
 * （見 migration 0013 與 supabase/functions/notify）。這裡只負責「讓伺服器知道
 * 要往哪台裝置送」。
 *
 * 網頁版整組跳過：瀏覽器推播是另一套機制（Service Worker + VAPID），
 * iOS Safari 還要先加到主畫面才有，不是同一件事。
 */

const CHANNEL = 'default';

/** app.json 的 extra.eas.projectId。Expo 的推播位址是綁專案的，沒有它拿不到 token。 */
function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId;
}

/**
 * App 在前景時收到通知也要跳出來。
 *
 * 預設是不跳的——系統假設「使用者已經在看這個 App 了」。但這裡不成立：
 * 你可能正在別的群組記帳，別人在另一個群組記了一筆，那則通知仍然有意義。
 */
export function configureNotifications(): void {
  if (Platform.OS === 'web') return;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  if (Platform.OS === 'android') {
    void Notifications.setNotificationChannelAsync(CHANNEL, {
      name: '記帳通知',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

/**
 * 註冊這台裝置，讓伺服器送得到通知。
 *
 * 每次啟動都跑一次：Expo 的 token 會因為重裝、還原備份、清資料而改變，
 * 而且是 upsert，重複註冊不會長出多餘的列。
 *
 * 全程不拋錯。通知是加分功能，權限被拒、沒網路、Firebase 還沒設好——
 * 任何一種都不該讓 App 起不來。
 */
export async function registerPushToken(userId: string): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    const existing = await Notifications.getPermissionsAsync();
    const granted =
      existing.granted ||
      (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return;

    const id = projectId();
    if (!id) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });

    await supabase.from('push_tokens').upsert({
      token,
      user_id: userId,
      platform: Platform.OS,
      updated_at: new Date().toISOString(),
    });
  } catch {
    // 靜默略過，見上面的說明
  }
}
