import { and, desc, eq, isNull } from 'drizzle-orm';

import { computeSplits, type SplitInput, type SplitType } from '../domain';
import { bump } from './changes';
import { db, sqlite } from './db';
import { childId, newId, newInviteCode } from './ids';
import {
  expensePayers,
  expenseSplits,
  expenses,
  groupMembers,
  groups,
  receipts,
  transfers,
} from './schema.local';
import { supabase } from './supabase';
import { kick } from './sync/engine';
import { enqueue } from './sync/outbox';
import type {
  Group,
  GroupSnapshot,
  Member,
  Receipt,
  SaveExpenseInput,
  SaveTransferInput,
  Transfer,
} from './types';

/**
 * Android 端的本地優先實作。
 *
 * 每個寫入都是一個 SQLite 交易：寫本地鏡像表 + enqueue outbox，
 * 然後 kick() 同步引擎盡快推出去。UI 只讀本地表，畫面即時反應，
 * 網路狀態只影響「多快到伺服器」，不影響體驗。
 *
 * 本地的 updated_at 先填用戶端時間讓排序看起來合理；
 * 伺服器 trigger 會蓋掉它，之後的 pull 再把權威值帶回來。
 */

const now = (): string => new Date().toISOString();

// ---------------------------------------------------------------- 讀取

export function listGroups(): Group[] {
  return db
    .select()
    .from(groups)
    .where(isNull(groups.deletedAt))
    .all()
    .map((g) => ({
      id: g.id,
      name: g.name,
      defaultCurrency: g.defaultCurrency,
      createdBy: g.createdBy,
      archivedAt: g.archivedAt,
    }));
}

export function newestActivityGroupId(): string | null {
  const newest = <T extends typeof expenses | typeof transfers>(table: T) =>
    db
      .select({ groupId: table.groupId, updatedAt: table.updatedAt })
      .from(table)
      .where(isNull(table.deletedAt))
      .orderBy(desc(table.updatedAt))
      .limit(1)
      .get();

  const rows = [newest(expenses), newest(transfers)].filter(
    (r): r is { groupId: string; updatedAt: string } => Boolean(r),
  );
  if (rows.length === 0) return null;

  rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return rows[0].groupId;
}

export function loadGroup(groupId: string): GroupSnapshot | null {
  const g = db.select().from(groups).where(eq(groups.id, groupId)).get();
  if (!g || g.deletedAt) return null;

  const members = db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), isNull(groupMembers.deletedAt)))
    .all();

  const expenseRows = db
    .select()
    .from(expenses)
    .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt)))
    .all();

  const payerRows = db
    .select()
    .from(expensePayers)
    .where(and(eq(expensePayers.groupId, groupId), isNull(expensePayers.deletedAt)))
    .all();

  const splitRows = db
    .select()
    .from(expenseSplits)
    .where(and(eq(expenseSplits.groupId, groupId), isNull(expenseSplits.deletedAt)))
    .all();

  const transferRows = db
    .select()
    .from(transfers)
    .where(and(eq(transfers.groupId, groupId), isNull(transfers.deletedAt)))
    .all();

  const receiptRows = db
    .select()
    .from(receipts)
    .where(and(eq(receipts.groupId, groupId), isNull(receipts.deletedAt)))
    .all();

  return {
    group: {
      id: g.id,
      name: g.name,
      defaultCurrency: g.defaultCurrency,
      createdBy: g.createdBy,
      archivedAt: g.archivedAt,
    },
    members: members.map(
      (m): Member => ({
        id: m.id,
        groupId: m.groupId,
        userId: m.userId,
        name: m.name,
        role: m.role,
        avatarPath: m.avatarPath,
      }),
    ),
    expenses: expenseRows.map((e) => ({
      id: e.id,
      groupId: e.groupId,
      title: e.title,
      category: e.category,
      currency: e.currency,
      amountMinor: e.amountMinor,
      splitType: e.splitType as SplitType,
      paidAt: e.paidAt,
      createdBy: e.createdBy,
      payers: payerRows
        .filter((p) => p.expenseId === e.id)
        .map((p) => ({ memberId: p.memberId, amountMinor: p.amountMinor })),
      splits: splitRows
        .filter((s) => s.expenseId === e.id)
        .map((s) => ({
          memberId: s.memberId,
          amountMinor: s.amountMinor,
          shareValue: s.shareValue,
        })),
    })),
    transfers: transferRows.map(
      (t): Transfer => ({
        id: t.id,
        groupId: t.groupId,
        fromMemberId: t.fromMemberId,
        toMemberId: t.toMemberId,
        currency: t.currency,
        amountMinor: t.amountMinor,
        paidCurrency: t.paidCurrency,
        paidAmountMinor: t.paidAmountMinor,
        paidRate: t.paidRate,
        note: t.note,
        paidAt: t.paidAt,
      }),
    ),
    receipts: receiptRows.map(
      (r): Receipt => ({
        id: r.id,
        expenseId: r.expenseId,
        groupId: r.groupId,
        storagePath: r.storagePath,
        localPath: r.localPath,
      }),
    ),
  };
}

// ---------------------------------------------------------------- 寫入

export function createGroup(input: {
  name: string;
  defaultCurrency: string;
  userId: string;
  memberName: string;
}): { groupId: string; memberId: string } {
  const groupId = newId();
  const memberId = newId();
  const ts = now();

  sqlite.withTransactionSync(() => {
    db.insert(groups)
      .values({
        id: groupId,
        name: input.name,
        defaultCurrency: input.defaultCurrency,
        createdBy: input.userId,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
    db.insert(groupMembers)
      .values({
        id: memberId,
        groupId,
        userId: input.userId,
        name: input.memberName,
        role: 'owner',
        joinedAt: ts,
        updatedAt: ts,
      })
      .run();
    enqueue({
      op: 'rpc',
      target: 'create_group',
      payload: {
        group_id: groupId,
        group_name: input.name,
        currency: input.defaultCurrency,
        member_id: memberId,
        member_name: input.memberName,
      },
    });
  });

  bump();
  kick();
  return { groupId, memberId };
}

export function addMember(input: { groupId: string; name: string; userId?: string }): string {
  const id = newId();
  const ts = now();

  sqlite.withTransactionSync(() => {
    db.insert(groupMembers)
      .values({
        id,
        groupId: input.groupId,
        userId: input.userId ?? null,
        name: input.name,
        role: 'editor',
        joinedAt: ts,
        updatedAt: ts,
      })
      .run();
    enqueue({
      op: 'upsert',
      target: 'group_members',
      payload: {
        id,
        group_id: input.groupId,
        user_id: input.userId ?? null,
        name: input.name,
        role: 'editor',
      },
    });
  });

  bump();
  kick();
  return id;
}

/**
 * 新增或編輯支出。分攤金額由 domain 層算出（最大餘數法），
 * 存結果 + 使用者輸入的原值（share_value），編輯時才能還原表單。
 * 編輯 = 子表整組取代：留下的 upsert、被移出的軟刪除。
 */
export function saveExpense(input: SaveExpenseInput): string {
  const expenseId = input.id ?? newId();
  const ts = now();

  const paidTotal = input.payers.reduce((sum, p) => sum + p.amountMinor, 0);
  if (paidTotal !== input.amountMinor) {
    throw new Error(`出錢總額 ${paidTotal} 與支出金額 ${input.amountMinor} 不符`);
  }

  const splits = computeSplits(input.amountMinor, input.splitType, input.splitInputs);
  const valueByMember = new Map(input.splitInputs.map((i: SplitInput) => [i.memberId, i.value ?? null]));

  sqlite.withTransactionSync(() => {
    const row = {
      id: expenseId,
      groupId: input.groupId,
      title: input.title,
      category: input.category ?? null,
      currency: input.currency,
      amountMinor: input.amountMinor,
      splitType: input.splitType,
      paidAt: input.paidAt,
      createdBy: input.userId,
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
    };
    db.insert(expenses)
      .values(row)
      .onConflictDoUpdate({ target: expenses.id, set: { ...row, createdAt: undefined } })
      .run();
    enqueue({
      op: 'upsert',
      target: 'expenses',
      payload: {
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
      },
    });

    replaceChildren({
      expenseId,
      groupId: input.groupId,
      ts,
      payers: input.payers,
      splits: splits.map((s) => ({
        memberId: s.memberId,
        amountMinor: s.amountMinor,
        shareValue: valueByMember.get(s.memberId) ?? null,
      })),
    });
  });

  bump();
  kick();
  return expenseId;
}

function replaceChildren(input: {
  expenseId: string;
  groupId: string;
  ts: string;
  payers: { memberId: string; amountMinor: number }[];
  splits: { memberId: string; amountMinor: number; shareValue: number | null }[];
}): void {
  const keptPayers = new Set(input.payers.map((p) => p.memberId));
  const keptSplits = new Set(input.splits.map((s) => s.memberId));

  // 被移出的成員：本地與伺服器都標記軟刪除
  for (const old of db
    .select()
    .from(expensePayers)
    .where(and(eq(expensePayers.expenseId, input.expenseId), isNull(expensePayers.deletedAt)))
    .all()) {
    if (keptPayers.has(old.memberId)) continue;
    db.update(expensePayers)
      .set({ deletedAt: input.ts, updatedAt: input.ts })
      .where(eq(expensePayers.id, old.id))
      .run();
    enqueue({
      op: 'upsert',
      target: 'expense_payers',
      payload: {
        id: old.id,
        expense_id: input.expenseId,
        group_id: input.groupId,
        member_id: old.memberId,
        amount_minor: old.amountMinor,
        deleted_at: input.ts,
      },
    });
  }

  for (const old of db
    .select()
    .from(expenseSplits)
    .where(and(eq(expenseSplits.expenseId, input.expenseId), isNull(expenseSplits.deletedAt)))
    .all()) {
    if (keptSplits.has(old.memberId)) continue;
    db.update(expenseSplits)
      .set({ deletedAt: input.ts, updatedAt: input.ts })
      .where(eq(expenseSplits.id, old.id))
      .run();
    enqueue({
      op: 'upsert',
      target: 'expense_splits',
      payload: {
        id: old.id,
        expense_id: input.expenseId,
        group_id: input.groupId,
        member_id: old.memberId,
        amount_minor: old.amountMinor,
        share_value: old.shareValue,
        deleted_at: input.ts,
      },
    });
  }

  for (const payer of input.payers) {
    const id = childId(input.expenseId, payer.memberId, 'payer');
    const row = {
      id,
      expenseId: input.expenseId,
      groupId: input.groupId,
      memberId: payer.memberId,
      amountMinor: payer.amountMinor,
      updatedAt: input.ts,
      deletedAt: null,
    };
    db.insert(expensePayers)
      .values(row)
      .onConflictDoUpdate({ target: expensePayers.id, set: row })
      .run();
    enqueue({
      op: 'upsert',
      target: 'expense_payers',
      payload: {
        id,
        expense_id: input.expenseId,
        group_id: input.groupId,
        member_id: payer.memberId,
        amount_minor: payer.amountMinor,
        deleted_at: null,
      },
    });
  }

  for (const split of input.splits) {
    const id = childId(input.expenseId, split.memberId, 'split');
    const row = {
      id,
      expenseId: input.expenseId,
      groupId: input.groupId,
      memberId: split.memberId,
      shareValue: split.shareValue,
      amountMinor: split.amountMinor,
      updatedAt: input.ts,
      deletedAt: null,
    };
    db.insert(expenseSplits)
      .values(row)
      .onConflictDoUpdate({ target: expenseSplits.id, set: row })
      .run();
    enqueue({
      op: 'upsert',
      target: 'expense_splits',
      payload: {
        id,
        expense_id: input.expenseId,
        group_id: input.groupId,
        member_id: split.memberId,
        share_value: split.shareValue,
        amount_minor: split.amountMinor,
        deleted_at: null,
      },
    });
  }
}

export function updateGroup(
  groupId: string,
  patch: { name?: string; defaultCurrency?: string },
): void {
  // 本地欄位與伺服器欄位名稱不同，兩邊各存一份對照
  const local: { name?: string; defaultCurrency?: string } = {};
  const remote: Record<string, string> = {};
  if (patch.name !== undefined) {
    local.name = patch.name;
    remote.name = patch.name;
  }
  if (patch.defaultCurrency !== undefined) {
    local.defaultCurrency = patch.defaultCurrency;
    remote.default_currency = patch.defaultCurrency;
  }
  if (Object.keys(remote).length === 0) return;

  const ts = now();
  sqlite.withTransactionSync(() => {
    db.update(groups)
      .set({ ...local, updatedAt: ts })
      .where(eq(groups.id, groupId))
      .run();
    enqueue({
      op: 'update',
      target: 'groups',
      payload: { id: groupId, values: remote },
    });
  });
  bump();
  kick();
}

export function deleteExpense(expenseId: string, groupId: string): void {
  const ts = now();
  sqlite.withTransactionSync(() => {
    db.update(expenses)
      .set({ deletedAt: ts, updatedAt: ts })
      .where(eq(expenses.id, expenseId))
      .run();
    enqueue({
      op: 'update',
      target: 'expenses',
      payload: { id: expenseId, values: { deleted_at: ts } },
    });
  });
  bump();
  kick();
}

export function saveTransfer(input: SaveTransferInput): string {
  if (input.fromMemberId === input.toMemberId) {
    throw new Error('付款人與收款人不能是同一個人');
  }

  const id = input.id ?? newId();
  const ts = now();

  sqlite.withTransactionSync(() => {
    const row = {
      id,
      groupId: input.groupId,
      fromMemberId: input.fromMemberId,
      toMemberId: input.toMemberId,
      currency: input.currency,
      amountMinor: input.amountMinor,
      paidCurrency: input.paidCurrency ?? null,
      paidAmountMinor: input.paidAmountMinor ?? null,
      paidRate: input.paidRate != null ? String(input.paidRate) : null,
      note: input.note ?? null,
      paidAt: input.paidAt,
      createdBy: input.userId,
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
    };
    db.insert(transfers)
      .values(row)
      .onConflictDoUpdate({ target: transfers.id, set: { ...row, createdAt: undefined } })
      .run();
    enqueue({
      op: 'upsert',
      target: 'transfers',
      payload: {
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
      },
    });
  });

  bump();
  kick();
  return id;
}

/**
 * 掛上收據。照片已經在本地壓縮存好，這裡做三件事（同一個交易）：
 * 寫本地列、排隊上傳檔案、排隊同步資料列。
 * 上傳走 outbox 是刻意的——離線拍的照片也要能等到有網路再送出去。
 */
export function attachReceipt(input: {
  expenseId: string;
  groupId: string;
  receiptId: string;
  storagePath: string;
  localUri: string;
}): void {
  const ts = now();

  sqlite.withTransactionSync(() => {
    db.insert(receipts)
      .values({
        id: input.receiptId,
        expenseId: input.expenseId,
        groupId: input.groupId,
        storagePath: input.storagePath,
        localPath: input.localUri,
        updatedAt: ts,
      })
      .onConflictDoUpdate({
        target: receipts.id,
        set: { storagePath: input.storagePath, localPath: input.localUri, updatedAt: ts },
      })
      .run();

    enqueue({
      op: 'upload',
      target: 'receipts',
      payload: {
        receiptId: input.receiptId,
        storagePath: input.storagePath,
        localUri: input.localUri,
      },
    });

    enqueue({
      op: 'upsert',
      target: 'receipts',
      payload: {
        id: input.receiptId,
        expense_id: input.expenseId,
        group_id: input.groupId,
        storage_path: input.storagePath,
        deleted_at: null,
      },
    });
  });

  bump();
  kick();
}

export function removeReceipt(receiptId: string, groupId: string): void {
  const ts = now();
  sqlite.withTransactionSync(() => {
    db.update(receipts)
      .set({ deletedAt: ts, updatedAt: ts })
      .where(eq(receipts.id, receiptId))
      .run();
    enqueue({
      op: 'update',
      target: 'receipts',
      payload: { id: receiptId, values: { deleted_at: ts } },
    });
  });
  bump();
  kick();
}

/**
 * 建立邀請碼。
 *
 * 這一項刻意「不」走離線佇列：邀請碼要立刻拿去分享給朋友，
 * 離線時產一組還沒上傳的碼，對方輸入只會得到「邀請碼無效」，
 * 比誠實地說「請先連上網路」更糟。
 */
export async function createInvite(groupId: string, userId: string): Promise<string> {
  const code = newInviteCode();
  const { error } = await supabase
    .from('group_invites')
    .insert({ id: newId(), group_id: groupId, code, created_by: userId });
  if (error) throw new Error(`建立邀請碼失敗：${error.message}`);
  return code;
}

/** 用邀請碼加入群組，同樣需要連線；成功後立刻拉一次資料 */
export async function joinByCode(code: string, memberName: string): Promise<string> {
  const { data, error } = await supabase.rpc('join_group_by_code', {
    invite_code: code.trim().toUpperCase(),
    member_name: memberName,
  });
  if (error) throw new Error(error.message.includes('邀請碼') ? error.message : `加入失敗：${error.message}`);
  return data as string;
}
