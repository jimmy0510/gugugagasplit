import { computeSplits, type SplitType } from '../domain';
import { bump } from './changes';
import { childId, newId, newInviteCode } from './ids';
import { uploadReceipt } from './receipts';
import { supabase } from './supabase';
import type {
  Group,
  GroupSnapshot,
  SaveExpenseInput,
  SaveTransferInput,
} from './types';

/**
 * Web 端的線上直連實作。
 *
 * 為什麼 Web 不共用 Android 的本地優先路徑：expo-sqlite 在瀏覽器要靠
 * WASM + SharedArrayBuffer，得替整個站台加上 COOP/COEP 標頭，
 * 靜態託管很難搞。Web 版定位是「iPhone 朋友的臨時入口」，
 * 線上直連已經夠用，也少一整層可能出錯的同步狀態。
 *
 * 代價寫在明處：Web 版沒有離線寫入能力。
 */

const nowIso = () => new Date().toISOString();

function fail(action: string, error: { message: string } | null): void {
  if (error) throw new Error(`${action}失敗：${error.message}`);
}

export async function listGroups(): Promise<Group[]> {
  const { data, error } = await supabase
    .from('groups')
    .select('id, name, default_currency, created_by, archived_at')
    .is('deleted_at', null);
  fail('載入群組', error);

  return (data ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    defaultCurrency: g.default_currency,
    createdBy: g.created_by,
    archivedAt: g.archived_at,
  }));
}

export async function newestActivityGroupId(): Promise<string | null> {
  // 只要各拿「最新的那一筆」就夠了，不必把全部帳目撈回來排序。
  // RLS 已經把範圍限制在自己看得到的群組。
  const newest = (table: 'expenses' | 'transfers') =>
    supabase
      .from(table)
      .select('group_id, updated_at')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

  const [expense, transfer] = await Promise.all([newest('expenses'), newest('transfers')]);
  const rows = [expense.data, transfer.data].filter(
    (r): r is { group_id: string; updated_at: string } => Boolean(r),
  );
  if (rows.length === 0) return null;

  rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return rows[0].group_id;
}

export async function loadGroup(groupId: string): Promise<GroupSnapshot | null> {
  const [g, members, expenses, payers, splits, transfers, receipts, profiles] = await Promise.all([
    supabase.from('groups').select('*').eq('id', groupId).is('deleted_at', null).maybeSingle(),
    supabase.from('group_members').select('*').eq('group_id', groupId).is('deleted_at', null),
    supabase.from('expenses').select('*').eq('group_id', groupId).is('deleted_at', null),
    supabase.from('expense_payers').select('*').eq('group_id', groupId).is('deleted_at', null),
    supabase.from('expense_splits').select('*').eq('group_id', groupId).is('deleted_at', null),
    supabase.from('transfers').select('*').eq('group_id', groupId).is('deleted_at', null),
    supabase.from('receipts').select('*').eq('group_id', groupId).is('deleted_at', null),
    // 頭像掛在使用者身上，靠 profiles 取；RLS 只讓有共同群組的人讀得到
    supabase.from('profiles').select('id, avatar_url'),
  ]);

  fail('載入群組', g.error);
  if (!g.data) return null;
  for (const r of [members, expenses, payers, splits, transfers, receipts]) fail('載入群組內容', r.error);

  const avatarByUser = new Map<string, string | null>(
    (profiles.data ?? []).map((p) => [p.id as string, (p.avatar_url as string | null) ?? null]),
  );

  return {
    group: {
      id: g.data.id,
      name: g.data.name,
      defaultCurrency: g.data.default_currency,
      createdBy: g.data.created_by,
      archivedAt: g.data.archived_at,
    },
    members: (members.data ?? []).map((m) => ({
      id: m.id,
      groupId: m.group_id,
      userId: m.user_id,
      name: m.name,
      role: m.role,
      avatarPath: avatarByUser.get(m.user_id) ?? null,
    })),
    expenses: (expenses.data ?? []).map((e) => ({
      id: e.id,
      groupId: e.group_id,
      title: e.title,
      category: e.category,
      currency: e.currency,
      amountMinor: Number(e.amount_minor),
      splitType: e.split_type as SplitType,
      paidAt: e.paid_at,
      createdBy: e.created_by,
      payers: (payers.data ?? [])
        .filter((p) => p.expense_id === e.id)
        .map((p) => ({ memberId: p.member_id, amountMinor: Number(p.amount_minor) })),
      splits: (splits.data ?? [])
        .filter((s) => s.expense_id === e.id)
        .map((s) => ({
          memberId: s.member_id,
          amountMinor: Number(s.amount_minor),
          shareValue: s.share_value == null ? null : Number(s.share_value),
        })),
    })),
    transfers: (transfers.data ?? []).map((t) => ({
      id: t.id,
      groupId: t.group_id,
      fromMemberId: t.from_member_id,
      toMemberId: t.to_member_id,
      currency: t.currency,
      amountMinor: Number(t.amount_minor),
      paidCurrency: t.paid_currency,
      paidAmountMinor: t.paid_amount_minor == null ? null : Number(t.paid_amount_minor),
      paidRate: t.paid_rate == null ? null : String(t.paid_rate),
      note: t.note,
      paidAt: t.paid_at,
    })),
    receipts: (receipts.data ?? []).map((r) => ({
      id: r.id,
      expenseId: r.expense_id,
      groupId: r.group_id,
      storagePath: r.storage_path,
      localPath: null,
    })),
  };
}

export async function createGroup(input: {
  name: string;
  defaultCurrency: string;
  userId: string;
  memberName: string;
}): Promise<{ groupId: string; memberId: string }> {
  const groupId = newId();
  const memberId = newId();

  const { error } = await supabase.rpc('create_group', {
    group_id: groupId,
    group_name: input.name,
    currency: input.defaultCurrency,
    member_id: memberId,
    member_name: input.memberName,
  });
  fail('建立群組', error);

  bump();
  return { groupId, memberId };
}

export async function addMember(input: {
  groupId: string;
  name: string;
  userId?: string;
}): Promise<string> {
  const id = newId();
  const { error } = await supabase.from('group_members').insert({
    id,
    group_id: input.groupId,
    user_id: input.userId ?? null,
    name: input.name,
    role: 'editor',
  });
  fail('新增成員', error);

  bump();
  return id;
}

export async function saveExpense(input: SaveExpenseInput): Promise<string> {
  const expenseId = input.id ?? newId();

  const paidTotal = input.payers.reduce((sum, p) => sum + p.amountMinor, 0);
  if (paidTotal !== input.amountMinor) {
    throw new Error(`出錢總額 ${paidTotal} 與支出金額 ${input.amountMinor} 不符`);
  }

  const splits = computeSplits(input.amountMinor, input.splitType, input.splitInputs);
  const valueByMember = new Map(input.splitInputs.map((i) => [i.memberId, i.value ?? null]));

  const expenseResult = await supabase.from('expenses').upsert({
    id: expenseId,
    group_id: input.groupId,
    title: input.title,
    category: input.category ?? null,
    currency: input.currency,
    amount_minor: input.amountMinor,
    split_type: input.splitType,
    paid_at: input.paidAt,
    created_by: input.userId,
    deleted_at: null,
  });
  fail('儲存支出', expenseResult.error);

  // 子表整組取代：留下的 upsert、被移出的軟刪除
  const ts = nowIso();
  const keptPayers = new Set(input.payers.map((p) => childId(expenseId, p.memberId, 'payer')));
  const keptSplits = new Set(splits.map((s) => childId(expenseId, s.memberId, 'split')));

  const payerUpserts = input.payers.map((p) => ({
    id: childId(expenseId, p.memberId, 'payer'),
    expense_id: expenseId,
    group_id: input.groupId,
    member_id: p.memberId,
    amount_minor: p.amountMinor,
    deleted_at: null,
  }));
  const splitUpserts = splits.map((s) => ({
    id: childId(expenseId, s.memberId, 'split'),
    expense_id: expenseId,
    group_id: input.groupId,
    member_id: s.memberId,
    share_value: valueByMember.get(s.memberId) ?? null,
    amount_minor: s.amountMinor,
    deleted_at: null,
  }));

  const [pRes, sRes] = await Promise.all([
    supabase.from('expense_payers').upsert(payerUpserts),
    supabase.from('expense_splits').upsert(splitUpserts),
  ]);
  fail('儲存出錢人', pRes.error);
  fail('儲存分攤', sRes.error);

  if (input.id) {
    const [oldPayers, oldSplits] = await Promise.all([
      supabase.from('expense_payers').select('id').eq('expense_id', expenseId).is('deleted_at', null),
      supabase.from('expense_splits').select('id').eq('expense_id', expenseId).is('deleted_at', null),
    ]);
    const staleP = (oldPayers.data ?? []).map((r) => r.id).filter((id) => !keptPayers.has(id));
    const staleS = (oldSplits.data ?? []).map((r) => r.id).filter((id) => !keptSplits.has(id));

    if (staleP.length) {
      fail('移除出錢人', (await supabase.from('expense_payers').update({ deleted_at: ts }).in('id', staleP)).error);
    }
    if (staleS.length) {
      fail('移除分攤', (await supabase.from('expense_splits').update({ deleted_at: ts }).in('id', staleS)).error);
    }
  }

  bump();
  return expenseId;
}

export async function updateGroup(
  groupId: string,
  patch: { name?: string; defaultCurrency?: string },
): Promise<void> {
  const values: Record<string, string> = {};
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.defaultCurrency !== undefined) values.default_currency = patch.defaultCurrency;
  if (Object.keys(values).length === 0) return;

  const { error } = await supabase.from('groups').update(values).eq('id', groupId);
  fail('更新群組', error);
  bump();
}

export async function deleteExpense(expenseId: string): Promise<void> {
  const { error } = await supabase
    .from('expenses')
    .update({ deleted_at: nowIso() })
    .eq('id', expenseId);
  fail('刪除支出', error);
  bump();
}

export async function saveTransfer(input: SaveTransferInput): Promise<string> {
  if (input.fromMemberId === input.toMemberId) {
    throw new Error('付款人與收款人不能是同一個人');
  }

  const id = input.id ?? newId();
  const { error } = await supabase.from('transfers').upsert({
    id,
    group_id: input.groupId,
    from_member_id: input.fromMemberId,
    to_member_id: input.toMemberId,
    currency: input.currency,
    amount_minor: input.amountMinor,
    paid_currency: input.paidCurrency ?? null,
    paid_amount_minor: input.paidAmountMinor ?? null,
    paid_rate: input.paidRate ?? null,
    note: input.note ?? null,
    paid_at: input.paidAt,
    created_by: input.userId,
    deleted_at: null,
  });
  fail('記錄還款', error);

  bump();
  return id;
}

/**
 * Web 端沒有離線佇列，所以直接上傳完再寫資料列。
 * 順序不能反——先寫列後上傳的話，上傳失敗會留下指向不存在檔案的紀錄。
 */
export async function attachReceipt(input: {
  expenseId: string;
  groupId: string;
  receiptId: string;
  storagePath: string;
  localUri: string;
}): Promise<void> {
  await uploadReceipt({
    localUri: input.localUri,
    receiptId: input.receiptId,
    storagePath: input.storagePath,
  });

  const { error } = await supabase.from('receipts').upsert({
    id: input.receiptId,
    expense_id: input.expenseId,
    group_id: input.groupId,
    storage_path: input.storagePath,
    deleted_at: null,
  });
  fail('儲存收據', error);
  bump();
}

export async function removeReceipt(receiptId: string): Promise<void> {
  const { error } = await supabase
    .from('receipts')
    .update({ deleted_at: nowIso() })
    .eq('id', receiptId);
  fail('移除收據', error);
  bump();
}

export async function createInvite(groupId: string, userId: string): Promise<string> {
  const code = newInviteCode();
  const { error } = await supabase
    .from('group_invites')
    .insert({ id: newId(), group_id: groupId, code, created_by: userId });
  fail('建立邀請碼', error);
  return code;
}

export async function joinByCode(code: string, memberName: string): Promise<string> {
  const { data, error } = await supabase.rpc('join_group_by_code', {
    invite_code: code.trim().toUpperCase(),
    member_name: memberName,
  });
  if (error) {
    throw new Error(error.message.includes('邀請碼') ? error.message : `加入失敗：${error.message}`);
  }
  bump();
  return data as string;
}
