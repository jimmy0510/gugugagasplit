-- gugugagasplit 初始 schema
--
-- 三個貫穿全部設計的原則：
--   1. 金額一律用 bigint 存「最小單位整數」，永不使用浮點數
--   2. 主鍵由用戶端產生（UUID），所以離線也能新增，且上傳用 upsert 天然冪等
--   3. 一律軟刪除（deleted_at），否則離線裝置永遠不知道某筆被刪了
--
-- 每張需要同步的表都有 group_id + updated_at，讓用戶端可以用
-- 「where group_id in (...) and updated_at > 游標」做增量拉取。
-- expense_payers / expense_splits / receipts 的 group_id 是刻意冗餘的，
-- 這樣 RLS 判斷和同步查詢都不必 join 回 expenses。

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 共用：updated_at 由資料庫寫入，不信任手機時鐘
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 幣別
-- ---------------------------------------------------------------------------

create table public.currencies (
  code        char(3) primary key,
  exponent    smallint not null check (exponent between 0 and 4),
  symbol      text     not null,
  name        text     not null
);

-- 注意：TWD 在 ISO 4217 上是 2 位，這裡刻意用 0，
-- 因為台灣實務上不使用分。詳見 src/domain/money.ts 的說明。
insert into public.currencies (code, exponent, symbol, name) values
  ('TWD', 0, 'NT$',  '新台幣'),
  ('JPY', 0, '¥',    '日圓'),
  ('KRW', 0, '₩',    '韓元'),
  ('VND', 0, '₫',    '越南盾'),
  ('USD', 2, '$',    '美元'),
  ('EUR', 2, '€',    '歐元'),
  ('GBP', 2, '£',    '英鎊'),
  ('CNY', 2, 'CN¥',  '人民幣'),
  ('HKD', 2, 'HK$',  '港幣'),
  ('SGD', 2, 'S$',   '新加坡幣'),
  ('AUD', 2, 'A$',   '澳幣'),
  ('CAD', 2, 'C$',   '加幣'),
  ('THB', 2, '฿',    '泰銖'),
  ('MYR', 2, 'RM',   '馬來西亞令吉'),
  ('PHP', 2, '₱',    '菲律賓披索'),
  ('CHF', 2, 'CHF ', '瑞士法郎'),
  ('NZD', 2, 'NZ$',  '紐西蘭幣');

-- ---------------------------------------------------------------------------
-- 使用者
-- ---------------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- 新使用者（含匿名登入）自動建立 profile
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 群組與成員
-- ---------------------------------------------------------------------------

create table public.groups (
  id               uuid primary key,
  name             text    not null check (length(trim(name)) > 0),
  -- 只是「新增支出時預設選這個幣別」，不再有任何換算意義
  default_currency char(3) not null references public.currencies(code),
  created_by       uuid    not null references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  archived_at      timestamptz,
  deleted_at       timestamptz
);

-- user_id 可為空 = 「幽靈成員」，朋友沒有帳號也能被記帳
create table public.group_members (
  id         uuid primary key,
  group_id   uuid not null references public.groups(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  name       text not null check (length(trim(name)) > 0),
  role       text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  joined_at  timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- 同一個人在同一個群組只能佔一個成員位（幽靈成員不受此限）
create unique index group_members_unique_user
  on public.group_members (group_id, user_id)
  where user_id is not null and deleted_at is null;

create table public.group_invites (
  id         uuid primary key,
  group_id   uuid not null references public.groups(id) on delete cascade,
  code       text not null unique check (length(code) between 6 and 32),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

-- ---------------------------------------------------------------------------
-- 支出
-- ---------------------------------------------------------------------------

create table public.expenses (
  id                 uuid primary key,
  group_id           uuid    not null references public.groups(id) on delete cascade,
  title              text    not null,
  category           text,
  -- 支出用「它自己的幣別」記帳與分攤，完全不做匯率換算。
  -- 各幣別的債各自獨立顯示，等使用者清算時再用自訂匯率結。
  currency           char(3) not null references public.currencies(code),
  amount_minor       bigint  not null check (amount_minor >= 0),

  split_type         text    not null check (split_type in ('equal', 'shares', 'percent', 'exact')),
  paid_at            timestamptz not null default now(),
  created_by         uuid    not null references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create table public.expense_payers (
  id                 uuid primary key,
  expense_id         uuid   not null references public.expenses(id) on delete cascade,
  group_id           uuid   not null references public.groups(id) on delete cascade,
  member_id          uuid   not null references public.group_members(id) on delete cascade,
  amount_minor       bigint not null check (amount_minor >= 0),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  unique (expense_id, member_id)
);

create table public.expense_splits (
  id                 uuid primary key,
  expense_id         uuid   not null references public.expenses(id) on delete cascade,
  group_id           uuid   not null references public.groups(id) on delete cascade,
  member_id          uuid   not null references public.group_members(id) on delete cascade,

  -- 使用者原本輸入的值：shares 是權重、percent 是萬分位、exact 是金額。
  -- 保留下來才能在編輯時還原成使用者當初填的樣子，而不是只剩結果。
  share_value        bigint,
  amount_minor       bigint not null,

  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  unique (expense_id, member_id)
);

create table public.receipts (
  id           uuid primary key,
  expense_id   uuid not null references public.expenses(id) on delete cascade,
  group_id     uuid not null references public.groups(id) on delete cascade,
  storage_path text not null,
  uploaded_at  timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

-- ---------------------------------------------------------------------------
-- 還款轉帳
-- ---------------------------------------------------------------------------

create table public.transfers (
  id                 uuid primary key,
  group_id           uuid    not null references public.groups(id) on delete cascade,
  from_member_id     uuid    not null references public.group_members(id) on delete cascade,
  to_member_id       uuid    not null references public.group_members(id) on delete cascade,

  -- currency/amount 是「被清掉的債」的幣別與金額，餘額計算只看這兩欄。
  currency           char(3) not null references public.currencies(code),
  amount_minor       bigint  not null check (amount_minor > 0),

  -- 跨幣別清算的紀錄：實際交付的幣別、金額、與雙方自訂的匯率。
  -- 純顯示用（「還 ¥3,000，實付 NT$630 @ 0.21」），不影響任何餘額。
  paid_currency      char(3) references public.currencies(code),
  paid_amount_minor  bigint  check (paid_amount_minor > 0),
  paid_rate          numeric(20, 10) check (paid_rate > 0),

  note               text,
  paid_at            timestamptz not null default now(),
  created_by         uuid    not null references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  check (from_member_id <> to_member_id)
);

-- ---------------------------------------------------------------------------
-- updated_at 觸發器
-- ---------------------------------------------------------------------------

create trigger groups_set_updated_at         before update on public.groups         for each row execute function public.set_updated_at();
create trigger group_members_set_updated_at  before update on public.group_members  for each row execute function public.set_updated_at();
create trigger expenses_set_updated_at       before update on public.expenses       for each row execute function public.set_updated_at();
create trigger expense_payers_set_updated_at before update on public.expense_payers for each row execute function public.set_updated_at();
create trigger expense_splits_set_updated_at before update on public.expense_splits for each row execute function public.set_updated_at();
create trigger receipts_set_updated_at       before update on public.receipts       for each row execute function public.set_updated_at();
create trigger transfers_set_updated_at      before update on public.transfers      for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 同步用索引：一律 (group_id, updated_at)
-- ---------------------------------------------------------------------------

create index group_members_sync_idx  on public.group_members  (group_id, updated_at);
create index expenses_sync_idx       on public.expenses       (group_id, updated_at);
create index expense_payers_sync_idx on public.expense_payers (group_id, updated_at);
create index expense_splits_sync_idx on public.expense_splits (group_id, updated_at);
create index receipts_sync_idx       on public.receipts       (group_id, updated_at);
create index transfers_sync_idx      on public.transfers      (group_id, updated_at);

create index expense_payers_expense_idx on public.expense_payers (expense_id);
create index expense_splits_expense_idx on public.expense_splits (expense_id);
create index group_members_user_idx     on public.group_members  (user_id);

-- ---------------------------------------------------------------------------
-- RLS
--
-- 所有權限都收斂到一個問題：「我是不是這個群組的成員？」
-- 用 SECURITY DEFINER 函式來回答，避免 policy 反過來查 group_members
-- 又觸發 group_members 自己的 policy 而無限遞迴——這是 Supabase RLS 最常見的坑。
-- ---------------------------------------------------------------------------

create or replace function public.is_group_member(gid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid
      and user_id = auth.uid()
      and deleted_at is null
  );
$$;

alter table public.profiles       enable row level security;
alter table public.currencies     enable row level security;
alter table public.groups         enable row level security;
alter table public.group_members  enable row level security;
alter table public.group_invites  enable row level security;
alter table public.expenses       enable row level security;
alter table public.expense_payers enable row level security;
alter table public.expense_splits enable row level security;
alter table public.receipts       enable row level security;
alter table public.transfers      enable row level security;

-- 參考資料：登入者皆可讀，只有 service role 能寫
create policy currencies_read on public.currencies
  for select to authenticated using (true);

-- 自己的 profile
create policy profiles_read_own on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- 群組
create policy groups_read on public.groups
  for select to authenticated using (public.is_group_member(id));
create policy groups_insert on public.groups
  for insert to authenticated with check (created_by = auth.uid());
create policy groups_update on public.groups
  for update to authenticated using (public.is_group_member(id)) with check (public.is_group_member(id));

-- 成員：建立者要能在群組剛建好、自己還不是成員時把自己加進去
create policy group_members_read on public.group_members
  for select to authenticated using (public.is_group_member(group_id));
create policy group_members_insert on public.group_members
  for insert to authenticated with check (
    public.is_group_member(group_id)
    or exists (select 1 from public.groups g where g.id = group_id and g.created_by = auth.uid())
  );
create policy group_members_update on public.group_members
  for update to authenticated using (public.is_group_member(group_id)) with check (public.is_group_member(group_id));

-- 邀請：只有成員看得到。非成員要加入是走下面的 RPC，不直接讀這張表
create policy group_invites_read on public.group_invites
  for select to authenticated using (public.is_group_member(group_id));
create policy group_invites_insert on public.group_invites
  for insert to authenticated with check (public.is_group_member(group_id) and created_by = auth.uid());
create policy group_invites_update on public.group_invites
  for update to authenticated using (public.is_group_member(group_id)) with check (public.is_group_member(group_id));

-- 帳目：全部用同一條規則
do $$
declare
  t text;
begin
  foreach t in array array['expenses', 'expense_payers', 'expense_splits', 'receipts', 'transfers']
  loop
    execute format(
      'create policy %1$s_read on public.%1$s for select to authenticated using (public.is_group_member(group_id))', t);
    execute format(
      'create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.is_group_member(group_id))', t);
    execute format(
      'create policy %1$s_update on public.%1$s for update to authenticated using (public.is_group_member(group_id)) with check (public.is_group_member(group_id))', t);
  end loop;
end;
$$;

-- 刻意不開放 DELETE：一律軟刪除，否則離線裝置不會知道資料被刪了

-- ---------------------------------------------------------------------------
-- 用邀請碼加入群組
--
-- 非成員讀不到 group_invites（那是刻意的），所以加入動作必須走這個
-- SECURITY DEFINER 函式：它自己驗證邀請碼，通過才建立成員資格。
-- ---------------------------------------------------------------------------

create or replace function public.join_group_by_code(invite_code text, member_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_group uuid;
  existing     uuid;
  new_member   uuid;
begin
  if auth.uid() is null then
    raise exception '需要先登入';
  end if;

  select group_id into target_group
  from public.group_invites
  where code = invite_code
    and revoked_at is null
    and (expires_at is null or expires_at > now());

  if target_group is null then
    raise exception '邀請碼無效或已過期';
  end if;

  select id into existing
  from public.group_members
  where group_id = target_group and user_id = auth.uid() and deleted_at is null;

  if existing is not null then
    return target_group;
  end if;

  new_member := gen_random_uuid();
  insert into public.group_members (id, group_id, user_id, name, role)
  values (new_member, target_group, auth.uid(), member_name, 'editor');

  return target_group;
end;
$$;

revoke all on function public.join_group_by_code(text, text) from public;
grant execute on function public.join_group_by_code(text, text) to authenticated;
