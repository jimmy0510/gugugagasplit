-- 資料保護：變更前存檔 + 擋下大量刪除
--
-- 起因：開發過程中我為了「清理測試資料」下了
--   delete from public.groups; delete from auth.users;
-- 結果把使用者真正的群組與帳號一起刪光，而且救不回來——
-- 免費方案沒有時間點還原。
--
-- 「以後小心一點」不是防護。這裡做兩層：
--   1. 任何列被修改或刪除之前，先把「變更前的樣子」存進 row_archive
--   2. 單一 delete 影響超過 25 列就直接拒絕，除非明確解除保險
--
-- 第 1 層讓事故可以還原，第 2 層讓事故不容易發生。

-- ---------------------------------------------------------------------------
-- 存檔表
-- ---------------------------------------------------------------------------

create table if not exists public.row_archive (
  id          bigserial primary key,
  table_name  text        not null,
  row_id      uuid,
  op          text        not null check (op in ('UPDATE', 'DELETE')),
  row_data    jsonb       not null,
  archived_at timestamptz not null default now()
);

create index if not exists row_archive_lookup_idx on public.row_archive (table_name, row_id, archived_at desc);
create index if not exists row_archive_time_idx on public.row_archive (archived_at);

-- 存檔內含所有使用者的資料，任何一般使用者都不該讀得到。
-- 開了 RLS 又不給任何 policy，等於只有 service_role 與 postgres 進得去。
alter table public.row_archive enable row level security;

comment on table public.row_archive is
  '變更前的資料快照，用於誤刪還原。保留 14 天。只有 service_role 讀得到。';

-- ---------------------------------------------------------------------------
-- 存檔觸發器
--
-- 只存 OLD（變更前的樣子）。INSERT 不必存——一筆資料若被新增後又刪除，
-- 刪除時本來就會把完整內容存下來，存 INSERT 只是讓存檔量加倍。
-- ---------------------------------------------------------------------------

create or replace function public.archive_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.row_archive (table_name, row_id, op, row_data)
  values (
    tg_table_name,
    case when to_jsonb(old) ? 'id' then (to_jsonb(old) ->> 'id')::uuid else null end,
    tg_op,
    to_jsonb(old)
  );
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- 大量刪除的保險
--
-- 用 statement 層級的觸發器數這次 delete 影響幾列。超過門檻就中止整個交易。
-- 真的要大量刪除時，在同一個交易裡先解除保險：
--   begin;
--   set local app.allow_bulk_delete = 'on';
--   delete from ...;
--   commit;
-- set local 只在該交易有效，不會意外留著。
-- ---------------------------------------------------------------------------

create or replace function public.guard_bulk_delete()
returns trigger
language plpgsql
as $$
declare
  affected integer;
begin
  if coalesce(current_setting('app.allow_bulk_delete', true), 'off') = 'on' then
    return null;
  end if;

  select count(*) into affected from deleted_rows;

  if affected > 25 then
    raise exception
      '拒絕執行：這個 delete 會刪掉 % 列 %，超過 25 列的保險門檻。'
      '確定要這麼做的話，在同一個交易裡先執行 set local app.allow_bulk_delete = ''on''。',
      affected, tg_table_name
      using hint = '誤刪的資料可以在 public.row_archive 找回（保留 14 天）。';
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 掛到所有存放使用者資料的表
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'groups', 'group_members', 'expenses', 'expense_payers',
    'expense_splits', 'transfers', 'receipts', 'group_invites', 'profiles'
  ]
  loop
    execute format('drop trigger if exists %1$s_archive on public.%1$s', t);
    execute format(
      'create trigger %1$s_archive before update or delete on public.%1$s
       for each row execute function public.archive_row()', t);

    execute format('drop trigger if exists %1$s_guard_bulk_delete on public.%1$s', t);
    execute format(
      'create trigger %1$s_guard_bulk_delete after delete on public.%1$s
       referencing old table as deleted_rows
       for each statement execute function public.guard_bulk_delete()', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 修剪：保留 14 天（使用者要求至少 3 天，這裡給足餘裕）
-- ---------------------------------------------------------------------------

create or replace function public.prune_row_archive()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.row_archive where archived_at < now() - interval '14 days';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

create extension if not exists pg_cron;

-- 每天 03:17 修剪一次。刻意避開整點——整點是所有排程最擁擠的時刻。
select cron.unschedule('prune-row-archive')
where exists (select 1 from cron.job where jobname = 'prune-row-archive');

select cron.schedule('prune-row-archive', '17 3 * * *', 'select public.prune_row_archive()');
