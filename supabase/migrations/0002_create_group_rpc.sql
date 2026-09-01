-- 建群組 RPC
--
-- 為什麼需要：直接 INSERT groups 再 INSERT group_members 有兩個問題：
--   1. INSERT groups 帶 RETURNING 會過不了 SELECT RLS（成員列還不存在，
--      is_group_member 是 false），PostgREST 會報 42501。
--   2. 兩步之間若斷線，會留下「沒有任何成員的群組」這種誰都看不到的孤兒。
-- 做成 SECURITY DEFINER 的原子函式一次解決。
--
-- id 由用戶端產生（離線也能建，之後同步）；重跑同 id 直接回傳，冪等。

create or replace function public.create_group(
  group_id uuid,
  group_name text,
  currency char(3),
  member_id uuid,
  member_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception '需要先登入';
  end if;

  if exists (select 1 from public.groups g where g.id = group_id) then
    -- 冪等：同一顆 UUID 重送（離線佇列重試）直接視為成功，
    -- 但只限本人建立的群組，避免拿別人的群組 id 騙加入
    if exists (
      select 1 from public.groups g
      where g.id = group_id and g.created_by = auth.uid()
    ) then
      return group_id;
    end if;
    raise exception '群組已存在';
  end if;

  insert into public.groups (id, name, default_currency, created_by)
  values (group_id, group_name, currency, auth.uid());

  insert into public.group_members (id, group_id, user_id, name, role)
  values (member_id, group_id, auth.uid(), member_name, 'owner');

  return group_id;
end;
$$;

revoke all on function public.create_group(uuid, text, char, uuid, text) from public;
grant execute on function public.create_group(uuid, text, char, uuid, text) to authenticated;
