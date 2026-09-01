import { eq } from 'drizzle-orm';

import { db, sqlite } from '../db';
import {
  expensePayers,
  expenseSplits,
  expenses,
  groupMembers,
  groups,
  receipts,
  syncState,
  transfers,
} from '../schema.local';
import { supabase } from '../supabase';

/**
 * 增量拉取。
 *
 * 游標 = 該表上次成功拉到的最大伺服器 updated_at（由 Postgres trigger 寫入，
 * 不信任任何手機時鐘）。每次查詢把游標往回退 1 秒製造重疊，
 * 靠本地 upsert 去重——寧可重拉也不漏拉同一秒內的多筆變更。
 *
 * groups 沒有 group_id 欄位可過濾，RLS 已保證只回傳自己所屬的群組；
 * 其他表也一樣靠 RLS 篩選，用戶端不用自己傳群組清單。
 */

const OVERLAP_MS = 1000;
const PAGE_SIZE = 500;

interface TableSpec {
  name: string;
  table:
    | typeof groups
    | typeof groupMembers
    | typeof expenses
    | typeof expensePayers
    | typeof expenseSplits
    | typeof transfers
    | typeof receipts;
  /** 伺服器欄位名 → 本地欄位名的轉換 */
  fromServer: (row: Record<string, unknown>) => Record<string, unknown>;
}

const s = (row: Record<string, unknown>, key: string) => row[key] as string | null;

const TABLES: TableSpec[] = [
  {
    name: 'groups',
    table: groups,
    fromServer: (r) => ({
      id: r.id,
      name: r.name,
      defaultCurrency: r.default_currency,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      archivedAt: s(r, 'archived_at'),
      deletedAt: s(r, 'deleted_at'),
    }),
  },
  {
    name: 'group_members',
    table: groupMembers,
    fromServer: (r) => ({
      id: r.id,
      groupId: r.group_id,
      userId: s(r, 'user_id'),
      name: r.name,
      role: r.role,
      joinedAt: r.joined_at,
      updatedAt: r.updated_at,
      deletedAt: s(r, 'deleted_at'),
    }),
  },
  {
    name: 'expenses',
    table: expenses,
    fromServer: (r) => ({
      id: r.id,
      groupId: r.group_id,
      title: r.title,
      category: s(r, 'category'),
      currency: r.currency,
      amountMinor: r.amount_minor,
      splitType: r.split_type,
      paidAt: r.paid_at,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      deletedAt: s(r, 'deleted_at'),
    }),
  },
  {
    name: 'expense_payers',
    table: expensePayers,
    fromServer: (r) => ({
      id: r.id,
      expenseId: r.expense_id,
      groupId: r.group_id,
      memberId: r.member_id,
      amountMinor: r.amount_minor,
      updatedAt: r.updated_at,
      deletedAt: s(r, 'deleted_at'),
    }),
  },
  {
    name: 'expense_splits',
    table: expenseSplits,
    fromServer: (r) => ({
      id: r.id,
      expenseId: r.expense_id,
      groupId: r.group_id,
      memberId: r.member_id,
      shareValue: r.share_value ?? null,
      amountMinor: r.amount_minor,
      updatedAt: r.updated_at,
      deletedAt: s(r, 'deleted_at'),
    }),
  },
  {
    name: 'transfers',
    table: transfers,
    fromServer: (r) => ({
      id: r.id,
      groupId: r.group_id,
      fromMemberId: r.from_member_id,
      toMemberId: r.to_member_id,
      currency: r.currency,
      amountMinor: r.amount_minor,
      paidCurrency: s(r, 'paid_currency'),
      paidAmountMinor: r.paid_amount_minor ?? null,
      paidRate: r.paid_rate == null ? null : String(r.paid_rate),
      note: s(r, 'note'),
      paidAt: r.paid_at,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      deletedAt: s(r, 'deleted_at'),
    }),
  },
  {
    name: 'receipts',
    table: receipts,
    fromServer: (r) => ({
      id: r.id,
      expenseId: r.expense_id,
      groupId: r.group_id,
      storagePath: r.storage_path,
      uploadedAt: s(r, 'uploaded_at'),
      updatedAt: r.updated_at,
      deletedAt: s(r, 'deleted_at'),
    }),
  },
];

function getCursor(tableName: string): string {
  const row = db.select().from(syncState).where(eq(syncState.tableName, tableName)).get();
  return row?.cursor ?? '1970-01-01T00:00:00Z';
}

function setCursor(tableName: string, cursor: string): void {
  db.insert(syncState)
    .values({ tableName, cursor })
    .onConflictDoUpdate({ target: syncState.tableName, set: { cursor } })
    .run();
}

/** 拉一張表的增量。回傳寫入筆數。 */
async function pullTable(spec: TableSpec): Promise<number> {
  let total = 0;

  for (;;) {
    const cursor = getCursor(spec.name);
    const since = new Date(new Date(cursor).getTime() - OVERLAP_MS).toISOString();

    const { data, error } = await supabase
      .from(spec.name)
      .select('*')
      .gt('updated_at', since)
      .order('updated_at', { ascending: true })
      .limit(PAGE_SIZE);

    if (error) {
      throw new Error(`拉取 ${spec.name} 失敗：${error.message}`);
    }
    if (!data || data.length === 0) {
      return total;
    }

    sqlite.withTransactionSync(() => {
      for (const serverRow of data) {
        const local = spec.fromServer(serverRow as Record<string, unknown>);
        // 衝突一律以伺服器為準（last-write-wins 由伺服器 updated_at 決定）
        db.insert(spec.table)
          .values(local as never)
          .onConflictDoUpdate({ target: spec.table.id, set: local as never })
          .run();
      }
      const last = data[data.length - 1] as { updated_at: string };
      setCursor(spec.name, last.updated_at);
    });

    total += data.length;
    if (data.length < PAGE_SIZE) {
      return total;
    }
  }
}

/**
 * 把同群組成員的頭像同步進本地的 group_members。
 *
 * 頭像掛在使用者（profiles）而不是成員列上，但畫面是照成員列渲染的，
 * 所以這裡把 profiles.avatar_url 攤平寫進對應的成員列，
 * 離線時也畫得出頭像。
 *
 * 沒有游標：profiles 的資料量等於群組人數，全抓一次比維護游標簡單，
 * 而且頭像換了才有變化，本來就不常動。
 */
async function pullAvatars(): Promise<number> {
  const { data, error } = await supabase.from('profiles').select('id, avatar_url');
  if (error || !data) return 0;

  let updated = 0;
  sqlite.withTransactionSync(() => {
    for (const row of data) {
      const userId = row.id as string;
      const avatarPath = (row.avatar_url as string | null) ?? null;
      db.update(groupMembers)
        .set({ avatarPath })
        .where(eq(groupMembers.userId, userId))
        .run();
      updated += 1;
    }
  });
  return updated;
}

/** 拉全部表的增量。回傳各表寫入筆數（除錯與 log 用）。 */
export async function pullAll(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const spec of TABLES) {
    counts[spec.name] = await pullTable(spec);
  }
  counts.avatars = await pullAvatars();
  return counts;
}
