import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 使用者在這台裝置上的顯示名稱。
 *
 * 匿名登入沒有 email 也沒有暱稱，這個名字就是別人在群組裡看到的你。
 * 存在本地就夠——加入群組時會複製一份到 group_members.name。
 */

const KEY = 'gugugagasplit.displayName';

/**
 * 本地儲存不該有能力卡住整個 App。
 * AsyncStorage 走原生橋接，理論上很快，但萬一沒回應（模組沒載入、
 * 新架構相容性問題），沒有逾時的話畫面會永遠停在載入中，
 * 而且完全看不出原因。
 */
function withTimeout<T>(promise: Promise<T>, fallback: T, ms = 3000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export async function getDisplayName(): Promise<string | null> {
  try {
    return await withTimeout(AsyncStorage.getItem(KEY), null);
  } catch {
    return null;
  }
}

export async function setDisplayName(name: string): Promise<void> {
  try {
    await withTimeout(AsyncStorage.setItem(KEY, name.trim()), undefined);
  } catch {
    // 存不進去不該擋住流程，最多下次再問一次名字
  }
}
