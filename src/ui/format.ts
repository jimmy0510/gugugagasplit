import { formatWithCurrency, type CurrencyAmounts } from '@/domain';

/** 把「幣別 → 金額」的表格排成一行字，例如「NT$200、¥3,000」 */
export function formatAmounts(row: CurrencyAmounts | undefined, options?: { abs?: boolean }): string {
  if (!row) return '—';
  const parts = Object.keys(row)
    .filter((currency) => row[currency] !== 0)
    .sort()
    .map((currency) => formatWithCurrency(options?.abs ? Math.abs(row[currency]) : row[currency], currency));
  return parts.length > 0 ? parts.join('、') : '—';
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`;
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * 支出的顯示名稱。項目是選填的，沒填就顯示佔位文字。
 *
 * 空字串是刻意存進資料庫的——若在儲存時塞一個「未命名支出」，
 * 使用者下次編輯會看到那四個字卡在欄位裡，還得自己刪掉。
 */
export function expenseTitle(title: string): string {
  return title.trim() || '（未命名）';
}
