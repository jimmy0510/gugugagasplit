-- 群組建立者可以移除已結清的成員
--
-- 「已結清」的判斷必須在伺服器端做，不能只靠 UI：餘額不為零的人被移除，
-- 那筆債就變成孤兒——付錢的人再也收不回來，而「每個幣別的淨額加總為 0」
-- 這條整個 App 賴以成立的不變式也會被打破。

-- ---------------------------------------------------------------------------
-- 單一成員的各幣別淨額
--
-- 與 src/domain/balance.ts 同一套規則：
--   出錢 => 增加、分攤 => 減少、轉出 => 增加、收到 => 減少
-- 只計入未刪除的支出與未刪除的子列。
-- ---------------------------------------------------------------------------

create or replace function public.member_net_balances(target_member uuid)
returns table (currency char(3), net bigint)
language sql
stable
security definer
set search_path = public
as $$
  with paid as (
    select e.currency, sum(p.amount_minor)::bigint as amt
    from public.expense_payers p
    join public.expenses e on e.id = p.expense_id
    where p.member_id = target_member and p.deleted_at is null and e.deleted_at is null
    group by e.currency
  ),
  owed as (
    select e.currency, sum(s.amount_minor)::bigint as amt
    from public.expense_splits s
    join public.expenses e on e.id = s.expense_id
    where s.member_id = target_member and s.deleted_at is null and e.deleted_at is null
    group by e.currency
  ),
  sent as (
    select t.currency, sum(t.amount_minor)::bigint as amt
    from public.transfers t
    where t.from_member_id = target_member and t.deleted_at is null
    group by t.currency
  ),
  received as (
    select t.currency, sum(t.amount_minor)::bigint as amt
    from public.transfers t
    where t.to_member_id = target_member and t.deleted_at is null
    group by t.currency
  ),
  all_currencies as (
    select currency from paid
    union select currency from owed
    union select currency from sent
    union select currency from received
  )
  select
    c.currency,
    coalesce(p.amt, 0) - coalesce(o.amt, 0) + coalesce(s.amt, 0) - coalesce(r.amt, 0)
  from all_currencies c
  left join paid p on p.currency = c.currency
  left join owed o on o.currency = c.currency
  left join sent s on s.currency = c.currency
  left join received r on r.currency = c.currency;
$$;

-- ---------------------------------------------------------------------------
-- 移除成員
--
-- 用軟刪除：歷史帳目仍然引用這個成員（他付過的錢、分攤過的項目都還在），
-- 硬刪除會讓過去的支出指向不存在的人。移除後畫面上不再列出他，
-- 舊帳目裡則顯示為「已移除」。
-- ---------------------------------------------------------------------------

create or replace function public.remove_member(target_member uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  gid          uuid;
  target_role  text;
  outstanding  text;
begin
  if auth.uid() is null then
    raise exception '需要先登入';
  end if;

  select group_id, role into gid, target_role
  from public.group_members
  where id = target_member and deleted_at is null;

  if gid is null then
    raise exception '找不到這位成員';
  end if;

  -- 只有群組建立者能移除人
  if not exists (
    select 1 from public.group_members m
    where m.group_id = gid
      and m.user_id = auth.uid()
      and m.role = 'owner'
      and m.deleted_at is null
  ) then
    raise exception '只有群組建立者可以移除成員';
  end if;

  if target_role = 'owner' then
    raise exception '不能移除群組建立者';
  end if;

  -- 關鍵條件：帳沒結清就不准移除，否則那筆債會變成沒有人負責的孤兒
  select string_agg(currency || ' ' || abs(net), '、')
  into outstanding
  from public.member_net_balances(target_member)
  where net <> 0;

  if outstanding is not null then
    raise exception '這位成員還沒結清（尚有 %），要先結清才能移除', outstanding;
  end if;

  update public.group_members
  set deleted_at = now()
  where id = target_member;
end;
$$;

revoke all on function public.member_net_balances(uuid) from public;
revoke all on function public.remove_member(uuid) from public;
grant execute on function public.member_net_balances(uuid) to authenticated;
grant execute on function public.remove_member(uuid) to authenticated;
