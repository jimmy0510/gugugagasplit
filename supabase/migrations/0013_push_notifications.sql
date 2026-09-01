-- 推播通知
--
-- 兩個時機：群組有人記了新支出（通知其他成員）、有人記錄還款（只通知收款人）。
--
-- 為什麼由資料庫觸發而不是由 App 送：通知該在「資料真的落到伺服器」的那一刻發出。
-- 原生端是離線優先的，畫面上按下儲存時那筆還在本地佇列裡，可能過幾分鐘才上傳；
-- 由 App 送就會變成「通知先到、資料後到」，別人點開什麼都看不到。

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- 裝置的推播位址
--
-- 主鍵用 token 而不是 (user_id, token)：同一台裝置換人登入時，
-- token 不變但 user_id 要改，用 token 當主鍵 upsert 就自然覆蓋掉舊的歸屬，
-- 不會出現「一個 token 同時屬於兩個人」而把通知送錯人。
-- ---------------------------------------------------------------------------
create table if not exists public.push_tokens (
  token      text        primary key,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  platform   text,
  updated_at timestamptz not null default now()
);

create index if not exists push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

-- 只能動自己的。刻意連 select 都不開給別人——推播位址等於「這個人現在用哪台裝置」。
create policy push_tokens_own on public.push_tokens
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 觸發器與 Edge Function 之間的共用密語
--
-- 開了 RLS 又不給任何 policy，等於只有 service_role 與 postgres 讀得到。
-- Function 收到請求時比對這串，確認是自家資料庫叫的，而不是外面隨便打進來
-- 想騙 App 跳通知的人。
-- ---------------------------------------------------------------------------
create table if not exists public.push_config (
  id     smallint primary key default 1 check (id = 1),
  secret text     not null default encode(gen_random_bytes(32), 'hex')
);

alter table public.push_config enable row level security;
insert into public.push_config (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 通知派送
--
-- 只丟「哪一種、哪一筆」過去，內容由 Function 自己查。
-- 觸發器裡不組訊息：payload 走 HTTP 出去，帶的東西越少越好，
-- 而且金額與名字的格式化留在一個地方就好。
--
-- net.http_post 是非同步的，排進佇列就回傳，不會拖慢寫入，
-- 也不會因為推播服務掛掉就讓人記不了帳。
-- ---------------------------------------------------------------------------
create or replace function public.notify_push()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  push_secret text;
begin
  select secret into push_secret from public.push_config where id = 1;
  if push_secret is null then
    return new;
  end if;

  perform net.http_post(
    url := 'https://ielczttxqhgmpefbolvb.supabase.co/functions/v1/notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', push_secret
    ),
    body := jsonb_build_object('kind', tg_argv[0], 'id', new.id)
  );

  return new;
end;
$$;

drop trigger if exists expenses_notify_push on public.expenses;
create trigger expenses_notify_push
  after insert on public.expenses
  for each row execute function public.notify_push('expense');

drop trigger if exists transfers_notify_push on public.transfers;
create trigger transfers_notify_push
  after insert on public.transfers
  for each row execute function public.notify_push('transfer');

revoke all on function public.notify_push() from public;
