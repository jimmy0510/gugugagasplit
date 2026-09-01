/**
 * 推播派送。
 *
 * 由資料庫觸發器呼叫（見 migration 0013）——支出或還款一寫進伺服器就送。
 * 進來的只有「哪一種、哪一筆」，內容自己查，因為 payload 要走 HTTP 出去，
 * 帶的東西越少越好。
 *
 * 兩個時機：
 *   expense  → 通知同群組其他成員（不通知記帳的人自己）
 *   transfer → 只通知收款人（付錢的人自己知道，不用再吵他）
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo 一次最多收 100 則 */
const CHUNK = 100;

interface Payload {
  kind: 'expense' | 'transfer';
  id: string;
}

/**
 * 金額格式化。
 *
 * 這裡刻意重寫一份極簡版而不是共用 src/domain——Edge Function 跑在 Deno，
 * 跟 App 的打包完全分開，為了一行字拉整個 domain 進來不划算。
 * 前提只有一條：所有幣別都記到小數點後第二位（見 migration 0011）。
 */
const SYMBOLS: Record<string, string> = {
  TWD: 'NT$',
  USD: '$',
  JPY: '¥',
  KRW: '₩',
  EUR: '€',
  CNY: 'CN¥',
  HKD: 'HK$',
  THB: '฿',
};

function money(minor: number, currency: string): string {
  const sign = minor < 0 ? '-' : '';
  const digits = Math.abs(minor).toString().padStart(3, '0');
  const int = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${SYMBOLS[currency] ?? `${currency} `}${int}.${digits.slice(-2)}`;
}

Deno.serve(async (req) => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 確認是自家資料庫叫的。沒有這一關，任何人都能對著這個網址亂打，
  // 讓別人的手機跳出不存在的帳。
  const { data: config } = await admin.from('push_config').select('secret').eq('id', 1).single();
  if (!config?.secret || req.headers.get('x-push-secret') !== config.secret) {
    return new Response('forbidden', { status: 403 });
  }

  const { kind, id } = (await req.json()) as Payload;

  let groupId: string;
  let actorUserId: string | null;
  let body: string;
  /** null = 群組裡除了發起人以外的所有人 */
  let onlyMemberId: string | null = null;

  if (kind === 'expense') {
    const { data: expense } = await admin
      .from('expenses')
      .select('group_id, title, currency, amount_minor, created_by')
      .eq('id', id)
      .single();
    if (!expense) return new Response('not found', { status: 200 });

    groupId = expense.group_id;
    actorUserId = expense.created_by;
    const title = (expense.title ?? '').trim();
    body = `${money(expense.amount_minor, expense.currency)}${title ? ` · ${title}` : ''}`;
  } else {
    const { data: transfer } = await admin
      .from('transfers')
      .select('group_id, to_member_id, currency, amount_minor, created_by')
      .eq('id', id)
      .single();
    if (!transfer) return new Response('not found', { status: 200 });

    groupId = transfer.group_id;
    actorUserId = transfer.created_by;
    onlyMemberId = transfer.to_member_id;
    body = `${money(transfer.amount_minor, transfer.currency)} 已還給你`;
  }

  const { data: group } = await admin.from('groups').select('name').eq('id', groupId).single();

  // 發起人的名字用群組裡的成員名，不是帳號的顯示名稱——
  // 同一個人在不同群組可能被叫不同的名字，畫面上顯示哪個、通知就該說哪個。
  const { data: members } = await admin
    .from('group_members')
    .select('id, user_id, name')
    .eq('group_id', groupId)
    .is('deleted_at', null);

  if (!members?.length) return new Response('no members', { status: 200 });

  const actorName = members.find((m) => m.user_id && m.user_id === actorUserId)?.name ?? '有人';

  const recipients = members
    .filter((m) => m.user_id && m.user_id !== actorUserId)
    .filter((m) => (onlyMemberId ? m.id === onlyMemberId : true))
    .map((m) => m.user_id as string);

  if (recipients.length === 0) return new Response('nobody to notify', { status: 200 });

  const { data: tokens } = await admin
    .from('push_tokens')
    .select('token')
    .in('user_id', recipients);

  if (!tokens?.length) return new Response('no devices', { status: 200 });

  const messages = tokens.map((row) => ({
    to: row.token,
    title: `${group?.name ?? '群組'} · ${actorName}`,
    body: kind === 'expense' ? `記了一筆 ${body}` : body,
    // 點通知要能直接跳進那個群組
    data: { groupId },
    sound: 'default',
    channelId: 'default',
  }));

  const failures: string[] = [];
  for (let i = 0; i < messages.length; i += CHUNK) {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages.slice(i, i + CHUNK)),
    });
    if (!res.ok) failures.push(`${res.status} ${await res.text()}`);
  }

  // 推播失敗不該讓資料庫那邊看起來像出錯——帳已經記好了，通知只是加分。
  // 回 200 但把失敗寫進內容，需要時可以在 Function 的日誌裡查。
  return new Response(JSON.stringify({ sent: messages.length, failures }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
