-- 群組建立者可以刪除群組
--
-- 軟刪除：只在 groups 上蓋 deleted_at，底下的支出、成員、轉帳一列都不動。
-- 清單與載入本來就會濾掉已刪除的群組，所以畫面上會整個消失；
-- 而萬一是誤刪，把 deleted_at 清回 null 就整組回來了，不必逐表還原。
--
-- 為什麼要走 RPC 而不是直接 update：groups 的 RLS 是「成員都能改」，
-- 那等於任何人都能刪掉別人的群組。權限檢查必須在伺服器端，
-- UI 上藏起按鈕只是體貼，不是防護。
--
-- 這裡刻意不檢查「帳有沒有結清」。移除單一成員時要檢查，是因為留下的債
-- 會變成沒有人負責的孤兒；整個群組刪掉則是連債帶帳一起收走，不會有孤兒。
create or replace function public.delete_group(target_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception '需要先登入';
  end if;

  if not exists (
    select 1 from public.group_members m
    where m.group_id = target_group
      and m.user_id = auth.uid()
      and m.role = 'owner'
      and m.deleted_at is null
  ) then
    raise exception '只有群組建立者可以刪除群組';
  end if;

  update public.groups
  set deleted_at = now()
  where id = target_group and deleted_at is null;
end;
$$;

revoke all on function public.delete_group(uuid) from public;
grant execute on function public.delete_group(uuid) to authenticated;
