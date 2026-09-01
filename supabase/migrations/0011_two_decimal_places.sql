-- 全部幣別改成記到小數點後第二位
--
-- 原本 TWD/JPY/KRW/VND 記到「元」（exponent 0），USD 等記到「分」。
-- 現在一律兩位，見 src/domain/money.ts。
--
-- amount_minor 存的是「幾個最小單位」，最小單位一變，同一個數字的意義
-- 就跟著變（100 從 NT$100 變成 NT$1.00）。所以程式改了就一定要跟著換算
-- 既有資料，不然帳目會整批縮水 100 倍。
--
-- 重跑安全：用 currencies.exponent 當「這批資料現在用幾位」的紀錄，
-- 換算完就寫回 2。第二次跑找不到 exponent <> 2 的幣別，什麼都不會做。
--
-- 還原點：row_archive 的 UPDATE 觸發器會把換算前的每一列存下來
-- （保留 14 天）。archived_at 早於這支 migration 的存檔都是舊尺度，
-- 真的要還原的話記得先 ×100。

-- 沒登記在 currencies 的幣別會被下面的 join 靜靜跳過，帳目就會 100 倍錯。
-- 寧可整支 migration 失敗，也不要換算到一半。
do $$
declare
  missing text;
begin
  select string_agg(distinct code, ', ') into missing
  from (
    select currency code from public.expenses
    union select currency from public.transfers
    union select paid_currency from public.transfers where paid_currency is not null
  ) used
  where code is not null
    and not exists (select 1 from public.currencies c where c.code = used.code);

  if missing is not null then
    raise exception '這些幣別沒有登記在 currencies，無法決定換算倍數：%', missing;
  end if;
end $$;

-- 換算倍數直接從 currencies 讀。刻意每次都重寫一次這段子查詢而不建暫存表：
-- 暫存表的生命週期取決於這支檔案是不是在單一交易裡跑，靠不住。
update public.expenses e
set amount_minor = e.amount_minor * s.factor
from (select code, (10 ^ (2 - exponent))::bigint as factor from public.currencies where exponent <> 2) s
where e.currency = s.code;

update public.expense_payers p
set amount_minor = p.amount_minor * s.factor
from public.expenses e, (select code, (10 ^ (2 - exponent))::bigint as factor from public.currencies where exponent <> 2) s
where p.expense_id = e.id and e.currency = s.code;

update public.expense_splits sp
set
  amount_minor = sp.amount_minor * s.factor,
  -- share_value 只有 exact 分法存的是金額；shares 是權重、percent 是萬分位，
  -- 兩者都與幣別無關，碰了反而會把分帳比例改掉。
  share_value = case when e.split_type = 'exact' then sp.share_value * s.factor else sp.share_value end
from public.expenses e, (select code, (10 ^ (2 - exponent))::bigint as factor from public.currencies where exponent <> 2) s
where sp.expense_id = e.id and e.currency = s.code;

update public.transfers t
set amount_minor = t.amount_minor * s.factor
from (select code, (10 ^ (2 - exponent))::bigint as factor from public.currencies where exponent <> 2) s
where t.currency = s.code;

-- 實付金額是另一種幣別，倍數要照它自己的來
update public.transfers t
set paid_amount_minor = t.paid_amount_minor * s.factor
from (select code, (10 ^ (2 - exponent))::bigint as factor from public.currencies where exponent <> 2) s
where t.paid_currency = s.code and t.paid_amount_minor is not null;

update public.currencies set exponent = 2 where exponent <> 2;

comment on column public.currencies.exponent is
  '小數位數。全部都是 2——這欄現在的用途是記錄「資料庫裡的金額用幾位小數存」，見 migration 0011。';
