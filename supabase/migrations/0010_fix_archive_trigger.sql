-- 修正：存檔觸發器把所有 UPDATE 靜默取消了
--
-- 0008 把 archive_row() 掛成 BEFORE UPDATE OR DELETE，而且回傳 OLD。
-- 在 PostgreSQL 裡，BEFORE UPDATE 的列級觸發器「回傳什麼就寫入什麼」——
-- 回傳 OLD 等於把這次更新改回原樣，操作被靜默取消，而且不會報任何錯。
--
-- 影響範圍是那 9 張表上的每一個 UPDATE：編輯支出、軟刪除、改名字、
-- 換頭像全都無效。是移除成員的測試把它抓出來的——RPC 回報成功，
-- 但讀回來 deleted_at 還是 null。
--
-- 改成 AFTER：AFTER 觸發器的回傳值會被忽略，結構上就不可能干擾操作本身。
-- 存檔這種「旁觀者」職責本來就該用 AFTER，用 BEFORE 是我一開始就選錯了。

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
  -- AFTER 觸發器的回傳值會被忽略，這裡回傳什麼都不影響資料
  return null;
end;
$$;

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
      'create trigger %1$s_archive after update or delete on public.%1$s
       for each row execute function public.archive_row()', t);
  end loop;
end;
$$;
