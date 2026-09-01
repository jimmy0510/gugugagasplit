-- 頭像
--
-- 頭像掛在「使用者」而不是「群組成員」上：換一次就到處生效，
-- 不用在每個群組各改一遍。代價是要放寬 profiles 的讀取權限——
-- 原本只准讀自己的，現在還要讓「有共同群組的人」讀得到。
--
-- 那條規則用 shares_group_with() 表達，並且是 SECURITY DEFINER，
-- 理由跟 is_group_member() 一樣：policy 內部若直接查 group_members，
-- 會再觸發 group_members 自己的 policy 而無限遞迴。

create or replace function public.shares_group_with(other_user uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = auth.uid()
      and mine.deleted_at is null
      and theirs.user_id = other_user
      and theirs.deleted_at is null
  );
$$;

-- profiles：自己的一定看得到，加上有共同群組的人
drop policy if exists profiles_read_own on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.shares_group_with(id));

-- 只能改自己的（原本就是，這裡重申以免日後看不出來）
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- 頭像檔案
--
-- 路徑規約：avatars/{user_id}/avatar.jpg
-- 第一段是 user_id，權限判斷直接看那一段。
-- 上限 2MB：用戶端會先壓到 512px 見方（約 60KB），這只是最後防線。
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "avatars_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and (
      (string_to_array(name, '/'))[1] = auth.uid()::text
      or public.shares_group_with(((string_to_array(name, '/'))[1])::uuid)
    )
  );

create policy "avatars_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (string_to_array(name, '/'))[1] = auth.uid()::text
  );

create policy "avatars_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (string_to_array(name, '/'))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (string_to_array(name, '/'))[1] = auth.uid()::text);
