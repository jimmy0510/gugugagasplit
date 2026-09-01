-- 用邀請碼查看群組的基本資訊（加入前的確認畫面用）
--
-- 為什麼需要：邀請連結要讓對方在加入前看到「你要加入的是『日本旅遊』」，
-- 否則他只是在按一個不知道會發生什麼事的按鈕。但 group_invites 與 groups
-- 的 RLS 都只開放給成員，非成員什麼都讀不到。
--
-- 所以開一個 SECURITY DEFINER 函式，只回傳確認畫面真正需要的兩項：
-- 群組名稱與人數。刻意不回傳成員名單、帳目或任何金額——
-- 拿到邀請碼的人在加入之前，不該看得到群組裡的內容。
--
-- 已知且可接受的揭露：持有有效邀請碼的人可以得知該群組的名稱與人數。
-- 那正是確認畫面存在的意義。

create or replace function public.peek_invite(invite_code text)
returns table (group_id uuid, group_name text, member_count integer)
language sql
security definer
stable
set search_path = public
as $$
  select
    g.id,
    g.name,
    (select count(*)::integer
     from public.group_members m
     where m.group_id = g.id and m.deleted_at is null)
  from public.group_invites i
  join public.groups g on g.id = i.group_id
  where i.code = invite_code
    and i.revoked_at is null
    and (i.expires_at is null or i.expires_at > now())
    and g.deleted_at is null;
$$;

revoke all on function public.peek_invite(text) from public;
grant execute on function public.peek_invite(text) to authenticated;
