-- 開啟即時廣播
--
-- 沒有這個，其他成員新增的支出只有在手動重整後才看得到——
-- 對一個「多人一起記帳」的 App 來說那等於沒做完。
--
-- Supabase 的 postgres_changes 會沿用 RLS：訂閱者只會收到他本來就
-- 讀得到的列的變更。所以這裡把表加進 publication 不會擴大任何人的
-- 可見範圍，只是讓「已經看得到的東西」變成即時更新。
--
-- 刻意不加入的表：
--   group_invites  邀請碼不需要即時，而且沒必要一直廣播
--   profiles       頭像變更不急，下次載入時更新就好
--   currencies     靜態資料

alter publication supabase_realtime add table public.groups;
alter publication supabase_realtime add table public.group_members;
alter publication supabase_realtime add table public.expenses;
alter publication supabase_realtime add table public.expense_payers;
alter publication supabase_realtime add table public.expense_splits;
alter publication supabase_realtime add table public.transfers;
alter publication supabase_realtime add table public.receipts;
