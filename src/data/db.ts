import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

import * as schema from './schema.local';

/**
 * 本地資料庫（原生端專用；Web 走 repo.remote 直連 Supabase，不會 import 這裡）。
 *
 * 遷移策略：schema 版本記在 PRAGMA user_version，開機時把落後的版本
 * 依序補上。DDL 直接寫 SQL，跟 schema.local.ts 的 Drizzle 定義人工對齊——
 * 表就這幾張，不值得為此引入 drizzle-kit 的產生器流程。
 */

const MIGRATIONS: string[] = [
  // v1：初始 schema
  `
  create table groups (
    id text primary key,
    name text not null,
    default_currency text not null,
    created_by text not null,
    created_at text not null,
    updated_at text not null,
    archived_at text,
    deleted_at text
  );

  create table group_members (
    id text primary key,
    group_id text not null,
    user_id text,
    name text not null,
    role text not null default 'editor',
    joined_at text not null,
    updated_at text not null,
    deleted_at text
  );
  create index group_members_group_idx on group_members (group_id);

  create table expenses (
    id text primary key,
    group_id text not null,
    title text not null,
    category text,
    currency text not null,
    amount_minor integer not null,
    split_type text not null,
    paid_at text not null,
    created_by text not null,
    created_at text not null,
    updated_at text not null,
    deleted_at text
  );
  create index expenses_group_idx on expenses (group_id, paid_at);

  create table expense_payers (
    id text primary key,
    expense_id text not null,
    group_id text not null,
    member_id text not null,
    amount_minor integer not null,
    updated_at text not null,
    deleted_at text
  );
  create index expense_payers_expense_idx on expense_payers (expense_id);
  create unique index expense_payers_unique on expense_payers (expense_id, member_id);

  create table expense_splits (
    id text primary key,
    expense_id text not null,
    group_id text not null,
    member_id text not null,
    share_value integer,
    amount_minor integer not null,
    updated_at text not null,
    deleted_at text
  );
  create index expense_splits_expense_idx on expense_splits (expense_id);
  create unique index expense_splits_unique on expense_splits (expense_id, member_id);

  create table transfers (
    id text primary key,
    group_id text not null,
    from_member_id text not null,
    to_member_id text not null,
    currency text not null,
    amount_minor integer not null,
    paid_currency text,
    paid_amount_minor integer,
    paid_rate text,
    note text,
    paid_at text not null,
    created_by text not null,
    created_at text not null,
    updated_at text not null,
    deleted_at text
  );
  create index transfers_group_idx on transfers (group_id, paid_at);

  create table receipts (
    id text primary key,
    expense_id text not null,
    group_id text not null,
    storage_path text not null,
    local_path text,
    uploaded_at text,
    updated_at text not null,
    deleted_at text
  );
  create index receipts_expense_idx on receipts (expense_id);

  create table outbox (
    seq integer primary key autoincrement,
    op text not null,
    target text not null,
    payload text not null,
    created_at text not null,
    attempts integer not null default 0,
    last_error text
  );
  create index outbox_created_idx on outbox (created_at);

  create table sync_state (
    table_name text primary key,
    cursor text not null
  );
  `,

  // v2：成員的頭像路徑。頭像本身掛在使用者身上，
  // 這裡鏡像一份是為了離線時也畫得出成員清單。
  `alter table group_members add column avatar_path text;`,
];

export const sqlite = openDatabaseSync('gugugagasplit.db', {
  enableChangeListener: true, // Drizzle useLiveQuery 靠這個
});

export function migrate(): void {
  sqlite.execSync('pragma journal_mode = wal;');
  sqlite.execSync('pragma foreign_keys = on;');

  const row = sqlite.getFirstSync<{ user_version: number }>('pragma user_version;');
  const current = row?.user_version ?? 0;

  for (let v = current; v < MIGRATIONS.length; v += 1) {
    sqlite.withTransactionSync(() => {
      sqlite.execSync(MIGRATIONS[v]);
      sqlite.execSync(`pragma user_version = ${v + 1};`);
    });
  }
}

export const db = drizzle(sqlite, { schema });
