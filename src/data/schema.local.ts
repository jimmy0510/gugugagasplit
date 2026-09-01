import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * 本地 SQLite schema——伺服器表的鏡像 + 同步機制用的兩張表。
 *
 * 鏡像原則：
 * - 欄位名與型別跟 Postgres 一致（金額 bigint → integer，JS 安全整數內夠用）
 * - 時間戳用 ISO 字串存（SQLite 沒有原生時間型別，字串可直接比大小）
 * - updated_at 由「伺服器」寫入，本地永遠只是快取它——同步游標靠它推進
 */

export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  defaultCurrency: text('default_currency').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  archivedAt: text('archived_at'),
  deletedAt: text('deleted_at'),
});

export const groupMembers = sqliteTable(
  'group_members',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id').notNull(),
    userId: text('user_id'),
    name: text('name').notNull(),
    role: text('role').notNull().default('editor'),
    avatarPath: text('avatar_path'),
    joinedAt: text('joined_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => [index('group_members_group_idx').on(t.groupId)],
);

export const expenses = sqliteTable(
  'expenses',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id').notNull(),
    title: text('title').notNull(),
    category: text('category'),
    currency: text('currency').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    splitType: text('split_type').notNull(),
    paidAt: text('paid_at').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => [index('expenses_group_idx').on(t.groupId, t.paidAt)],
);

export const expensePayers = sqliteTable(
  'expense_payers',
  {
    id: text('id').primaryKey(),
    expenseId: text('expense_id').notNull(),
    groupId: text('group_id').notNull(),
    memberId: text('member_id').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => [
    index('expense_payers_expense_idx').on(t.expenseId),
    uniqueIndex('expense_payers_unique').on(t.expenseId, t.memberId),
  ],
);

export const expenseSplits = sqliteTable(
  'expense_splits',
  {
    id: text('id').primaryKey(),
    expenseId: text('expense_id').notNull(),
    groupId: text('group_id').notNull(),
    memberId: text('member_id').notNull(),
    shareValue: integer('share_value'),
    amountMinor: integer('amount_minor').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => [
    index('expense_splits_expense_idx').on(t.expenseId),
    uniqueIndex('expense_splits_unique').on(t.expenseId, t.memberId),
  ],
);

export const transfers = sqliteTable(
  'transfers',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id').notNull(),
    fromMemberId: text('from_member_id').notNull(),
    toMemberId: text('to_member_id').notNull(),
    currency: text('currency').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    paidCurrency: text('paid_currency'),
    paidAmountMinor: integer('paid_amount_minor'),
    paidRate: text('paid_rate'), // numeric 存字串，顯示用而已
    note: text('note'),
    paidAt: text('paid_at').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => [index('transfers_group_idx').on(t.groupId, t.paidAt)],
);

export const receipts = sqliteTable(
  'receipts',
  {
    id: text('id').primaryKey(),
    expenseId: text('expense_id').notNull(),
    groupId: text('group_id').notNull(),
    storagePath: text('storage_path').notNull(),
    /** 還沒上傳前，本地檔案的路徑（上傳完成後清掉） */
    localPath: text('local_path'),
    uploadedAt: text('uploaded_at'),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => [index('receipts_expense_idx').on(t.expenseId)],
);

/**
 * 送出佇列。每筆本地寫入都在同一個交易裡追加一列，
 * 連上網後依 seq 順序重放到 Supabase（upsert，天然冪等）。
 */
export const outbox = sqliteTable(
  'outbox',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    /** 'upsert' | 'rpc' */
    op: text('op').notNull(),
    /** upsert 的目標表名，或 rpc 的函式名 */
    target: text('target').notNull(),
    /** JSON 字串：upsert 的整列資料，或 rpc 的參數 */
    payload: text('payload').notNull(),
    createdAt: text('created_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [index('outbox_created_idx').on(t.createdAt)],
);

/** 每張表一個同步游標（上次成功拉到的伺服器 updated_at） */
export const syncState = sqliteTable('sync_state', {
  tableName: text('table_name').primaryKey(),
  cursor: text('cursor').notNull(),
});

export type GroupRow = typeof groups.$inferSelect;
export type GroupMemberRow = typeof groupMembers.$inferSelect;
export type ExpenseRow = typeof expenses.$inferSelect;
export type ExpensePayerRow = typeof expensePayers.$inferSelect;
export type ExpenseSplitRow = typeof expenseSplits.$inferSelect;
export type TransferRow = typeof transfers.$inferSelect;
export type ReceiptRow = typeof receipts.$inferSelect;
export type OutboxRow = typeof outbox.$inferSelect;
