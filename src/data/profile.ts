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

/**
 * 群組在切換列上的左右順序（拖曳排的那個）。
 *
 * 只存在本地：這是「我習慣把哪個放前面」的個人偏好，不是群組本身的屬性，
 * 同一個群組的兩個成員各自排各自的。代價是換裝置要重排一次。
 *
 * 存 id 陣列而不是每個群組一個名次——名次要靠全部一起寫才不會互相矛盾，
 * 一個陣列天生就是一致的。清單裡沒提到的群組（新加入的）排在最後面。
 */
const ORDER_KEY = 'gugugagasplit.groupOrder';

export async function getGroupOrder(): Promise<string[]> {
  try {
    const raw = await withTimeout(AsyncStorage.getItem(ORDER_KEY), null);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    // 存壞了就當成沒排過，不值得讓首頁開不起來
    return [];
  }
}

export async function setGroupOrder(groupIds: string[]): Promise<void> {
  try {
    await withTimeout(AsyncStorage.setItem(ORDER_KEY, JSON.stringify(groupIds)), undefined);
  } catch {
    // 記不住就下次退回預設順序
  }
}
