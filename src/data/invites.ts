import { supabase } from './supabase';

/**
 * 邀請連結與加入流程。
 *
 * 這一塊本質上需要連線（要跟伺服器確認邀請碼），所以不走
 * Repository 的離線/線上分流，直接打 Supabase。
 */

/** 網頁版的網址。邀請連結指向這裡，朋友不必先安裝任何東西 */
export const WEB_BASE_URL = 'https://gugugagasplit.expo.app';

export const inviteLinkFor = (code: string) => `${WEB_BASE_URL}/join/${code}`;

export interface InvitePreview {
  groupId: string;
  groupName: string;
  memberCount: number;
}

/**
 * 加入前先看一眼這個邀請碼指向哪個群組。
 *
 * 回傳 null 代表邀請碼無效、已撤銷或已過期——三種情況對使用者來說
 * 都是同一件事（這個連結不能用），沒必要分別告知。
 */
export async function peekInvite(code: string): Promise<InvitePreview | null> {
  const { data, error } = await supabase.rpc('peek_invite', {
    invite_code: code.trim().toUpperCase(),
  });
  if (error) throw new Error(`讀取邀請失敗：${error.message}`);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  return {
    groupId: row.group_id as string,
    groupName: row.group_name as string,
    memberCount: Number(row.member_count),
  };
}

/**
 * 移除成員。伺服器端會檢查「呼叫者是群組建立者」與「對方已結清」，
 * 任一不成立就拋錯，錯誤訊息直接來自資料庫，已經是中文。
 */
export async function removeMember(memberId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_member', { target_member: memberId });
  if (error) throw new Error(error.message);
}

/**
 * 刪除群組（軟刪除）。伺服器端會檢查呼叫者是不是群組建立者。
 *
 * 跟 removeMember 一樣不走 Repository 的離線分流：這是不可逆的動作，
 * 排進佇列等連線只會讓人以為刪掉了、下次開又還在。
 */
export async function deleteGroup(groupId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_group', { target_group: groupId });
  if (error) throw new Error(error.message);
}
