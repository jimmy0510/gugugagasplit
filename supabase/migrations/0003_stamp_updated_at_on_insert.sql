-- 修正：updated_at 在 INSERT 時也必須由伺服器蓋章
--
-- 原本的觸發器只掛 BEFORE UPDATE，所以 INSERT（含 upsert 走到插入那條路）
-- 會直接採用用戶端送來的 updated_at。這在同步上是會靜默吃掉資料的問題：
--
--   - 手機時鐘慢了（或使用者手動改過時間），寫入的列帶著過去的時間戳，
--     其他裝置的游標已經超過那個時間 → 那筆資料永遠拉不到，而且沒有任何錯誤
--   - 反過來若時鐘快了，游標會被推到未來 → 之後一段時間內的變更全被跳過
--
-- 整套增量同步的前提是「updated_at 由單一權威時鐘產生」，也就是資料庫。
-- 這裡改成 BEFORE INSERT OR UPDATE，用戶端送什麼都會被覆蓋。

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'groups', 'group_members', 'expenses',
    'expense_payers', 'expense_splits', 'receipts', 'transfers'
  ]
  loop
    execute format('drop trigger if exists %1$s_set_updated_at on public.%1$s', t);
    execute format(
      'create trigger %1$s_set_updated_at before insert or update on public.%1$s
       for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;
