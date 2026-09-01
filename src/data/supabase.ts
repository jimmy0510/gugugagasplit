import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;

if (!url || !key) {
  throw new Error('缺少 EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_KEY，檢查 .env');
}

/**
 * 全 App 共用的 Supabase client。
 *
 * 原生端把 session 存進 AsyncStorage；Web 端讓 supabase-js 用預設的
 * localStorage（傳 AsyncStorage 進去在 SSR/靜態輸出時會炸）。
 * 匿名登入的 session 就是使用者的身分，遺失等於換了一個人，
 * 所以 persistSession 必須開著。
 */
export const supabase = createClient(url, key, {
  auth: {
    ...(Platform.OS !== 'web' ? { storage: AsyncStorage } : {}),
    autoRefreshToken: true,
    persistSession: true,
    // Web 要開：驗證信裡的連結會把 token 帶在網址上回到站台，
    // 關掉的話點連結就沒有任何效果。原生端沒有網址列，不需要。
    detectSessionInUrl: Platform.OS === 'web',
  },
});

let currentUserId: string | null = null;

/**
 * 確保有登入（沒有就匿名註冊一個），回傳 user id。
 *
 * 有 session 還不夠——匿名帳號可能已經在伺服器端消失（Supabase 會清理
 * 長期未使用的匿名使用者），此時本地 token 仍然「看起來有效」，
 * 但任何寫入都會撞上 created_by 的外鍵而失敗，錯誤訊息還是一句
 * 使用者看不懂的 SQL。所以這裡向伺服器確認帳號是否還在。
 *
 * 但不能因為「連不上網」就把人登出——那會讓離線使用者失去身分、
 * 連本地資料都讀不到。所以只在伺服器「明確回答帳號無效」時才重新註冊。
 */
export async function ensureSignedIn(): Promise<string> {
  const { data } = await supabase.auth.getSession();

  if (data.session) {
    currentUserId = data.session.user.id;

    const { error } = await supabase.auth.getUser();
    if (!error || !isAuthRejection(error)) {
      return currentUserId;
    }
    // 帳號真的不見了，清掉本地 session 後往下重新註冊一個
    await supabase.auth.signOut();
    currentUserId = null;
  }

  const { data: anon, error } = await supabase.auth.signInAnonymously();
  if (error || !anon.user) {
    throw new Error(`匿名登入失敗：${error?.message ?? '未知錯誤'}`);
  }
  currentUserId = anon.user.id;
  return currentUserId;
}

/** 401/403 才算「帳號無效」；沒有 status 通常是網路問題，不能據此登出 */
function isAuthRejection(error: { status?: number }): boolean {
  return error.status === 401 || error.status === 403;
}

// ---------------------------------------------------------------- 身分綁定

export interface Identity {
  userId: string;
  /** 已綁定的 email；null 表示還是純匿名帳號 */
  email: string | null;
  isAnonymous: boolean;
}

export async function getIdentity(): Promise<Identity | null> {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return null;
  return {
    userId: user.id,
    email: user.email ?? null,
    isAnonymous: user.is_anonymous ?? false,
  };
}

/**
 * 把匿名帳號綁上 email。
 *
 * 為什麼需要：網頁版的身分只存在瀏覽器的 localStorage 裡，清除網站資料、
 * 換裝置、或 iOS Safari 的 ITP（超過 7 天沒開就清掉 script 可寫的儲存空間）
 * 都會讓身分永久消失，連帶所有群組都進不去，而且沒有任何補救辦法。
 * 綁定 email 之後，任何裝置都能用驗證碼把「同一個 user id」找回來。
 *
 * 綁定不會換掉 user id，所以群組成員資格、記過的帳全都原樣保留。
 */
export async function requestEmailBinding(email: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ email: email.trim() });
  if (error) throw new Error(describeAuthError(error, '寄送驗證碼'));
}

/** 輸入信中的 6 位數驗證碼完成綁定 */
export async function confirmEmailBinding(email: string, code: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: code.trim(),
    type: 'email_change',
  });
  if (error) throw new Error(describeAuthError(error, '驗證'));
}

/**
 * 在新裝置上用 email 把身分找回來。
 *
 * shouldCreateUser 一定要是 false：預設值是 true，打錯一個字母就會
 * 「成功登入」一個全新的空帳號，使用者只會看到自己的群組全部不見，
 * 卻沒有任何錯誤訊息提示他打錯了。寧可明確地說「這個 email 沒有綁過」。
 */
export async function requestRecovery(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: false },
  });
  if (error) throw new Error(describeAuthError(error, '寄送驗證碼'));
}

export async function confirmRecovery(email: string, code: string): Promise<string> {
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: code.trim(),
    type: 'email',
  });
  if (error || !data.user) throw new Error(describeAuthError(error, '驗證'));
  currentUserId = data.user.id;
  return currentUserId;
}

/**
 * 把 Supabase 的英文錯誤換成看得懂的說明。
 * 寄信有速率上限，撞到時直接說「過一陣子再試」，
 * 比顯示英文的 rate limit exceeded 有用得多。
 * 這裡刻意不寫死每小時幾封——那個數字會隨 SMTP 設定改變而過期。
 */
function describeAuthError(error: { message?: string; status?: number } | null, action: string): string {
  const raw = error?.message ?? '未知錯誤';
  const lower = raw.toLowerCase();

  if (lower.includes('rate limit') || lower.includes('too many') || error?.status === 429) {
    return '驗證信寄太多次了，請過一陣子再試。';
  }
  if (lower.includes('signups not allowed') || lower.includes('user not found')) {
    return '這個 email 沒有綁定過任何帳號。請確認拼字，或在原本的裝置上先完成綁定。';
  }
  if (lower.includes('expired') || lower.includes('invalid') || lower.includes('token')) {
    return '驗證碼不正確或已過期（有效期一小時），請重新寄一次。';
  }
  if (lower.includes('already been registered') || lower.includes('already registered')) {
    return '這個 email 已經綁在另一個帳號上了。請改用「換裝置／找回身分」把那個帳號登入回來。';
  }
  return `${action}失敗：${raw}`;
}

/**
 * 目前登入者 id。根 layout 會在渲染任何畫面前先跑完 ensureSignedIn()，
 * 所以畫面裡讀到的一定不是 null。
 */
export function getUserId(): string {
  if (!currentUserId) throw new Error('尚未登入');
  return currentUserId;
}
