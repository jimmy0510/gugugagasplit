-- 收據照片的 Storage bucket 與存取規則
--
-- 路徑規約：receipts/{group_id}/{receipt_id}.jpg
-- 權限跟資料表一樣收斂到同一個問題：「我是不是這個群組的成員？」
-- 路徑的第一段就是 group_id，直接餵給 is_group_member() 判斷。
--
-- 上限 5MB：用戶端上傳前會壓到 ~1600px / JPEG q0.7（約 300KB），
-- 這裡的限制只是最後防線，擋住沒壓縮就硬塞的情況。

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "receipts_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    and public.is_group_member(((string_to_array(name, '/'))[1])::uuid)
  );

create policy "receipts_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and public.is_group_member(((string_to_array(name, '/'))[1])::uuid)
  );

-- 允許覆蓋上傳（同一張收據重拍）
create policy "receipts_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'receipts'
    and public.is_group_member(((string_to_array(name, '/'))[1])::uuid)
  )
  with check (
    bucket_id = 'receipts'
    and public.is_group_member(((string_to_array(name, '/'))[1])::uuid)
  );

-- 檔案刪除跟著支出的軟刪除走邏輯層，不開放直接 DELETE
