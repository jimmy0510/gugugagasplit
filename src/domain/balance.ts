import { type CurrencyCode, type Minor } from './money';

/**
 * 多幣別記帳模型：
 *
 * 支出用「它自己的幣別」記帳與分攤，完全不做匯率換算。
 * 日圓的債就是日圓、台幣的債就是台幣，畫面上兩者並列顯示，
 * 等使用者要清算時再用他們自己講好的匯率結（見 transfers 的 paid_* 欄位）。
 *
 * 好處：每個幣別內部都是純整數運算，「每個幣別的淨額加總 = 0」
 * 這條不變式永遠精確成立，不會被匯率的四捨五入污染。
 */

export interface PayerShare {
  memberId: string;
  amountMinor: Minor;
}

export interface SplitShare {
  memberId: string;
  amountMinor: Minor;
}

export interface ExpenseForBalance {
  id: string;
  /** 這筆支出的幣別，分攤金額都以此幣別的最小單位表示 */
  currency: CurrencyCode;
  payers: PayerShare[];
  splits: SplitShare[];
}

/**
 * 一筆還款。currency/amountMinor 是「被清掉的債」的幣別與金額——
 * 就算實際上是用另一種幣別付的（例如用台幣還日圓債），餘額也只動
 * 債的那個幣別。實付幣別與金額只是給人看的紀錄，不進餘額計算。
 */
export interface TransferForBalance {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  currency: CurrencyCode;
  amountMinor: Minor;
}

/** 幣別 → 金額。正數 = 該收，負數 = 該付 */
export type CurrencyAmounts = Record<CurrencyCode, Minor>;

/** 成員 → 各幣別淨額 */
export type MultiBalances = Record<string, CurrencyAmounts>;

export interface BalanceResult {
  balances: MultiBalances;
  /**
   * 出錢總額與分攤總額對不起來的支出。
   *
   * 正常情況不會發生，但離線同步時可能只拉到 expense_payers 還沒拉到
   * expense_splits，這種半套資料若照算會讓該幣別的淨額加總不等於 0。
   * 這裡選擇跳過並回報，而不是拋錯讓整個餘額畫面掛掉。
   */
  inconsistentExpenseIds: string[];
}

function total(items: { amountMinor: Minor }[]): Minor {
  return items.reduce((sum, item) => sum + item.amountMinor, 0);
}

/**
 * 算每個人各幣別的淨額。
 *
 * 出錢 => 該幣別淨額增加（幫大家墊了錢）
 * 分攤 => 該幣別淨額減少（消費掉的部分）
 * 轉帳 => 付款方增加、收款方減少（還錢抵銷債務）
 *
 * 在資料完整的前提下，「每個幣別」的淨額加總必定剛好等於 0。
 */
export function computeNetBalances(
  expenses: ExpenseForBalance[],
  transfers: TransferForBalance[],
  memberIds: string[] = [],
): BalanceResult {
  const balances: MultiBalances = {};
  const inconsistentExpenseIds: string[] = [];

  const bump = (memberId: string, currency: CurrencyCode, delta: Minor) => {
    const row = (balances[memberId] ??= {});
    row[currency] = (row[currency] ?? 0) + delta;
  };

  for (const memberId of memberIds) {
    balances[memberId] ??= {};
  }

  for (const expense of expenses) {
    if (total(expense.payers) !== total(expense.splits)) {
      inconsistentExpenseIds.push(expense.id);
      continue;
    }
    for (const payer of expense.payers) {
      bump(payer.memberId, expense.currency, payer.amountMinor);
    }
    for (const split of expense.splits) {
      bump(split.memberId, expense.currency, -split.amountMinor);
    }
  }

  for (const transfer of transfers) {
    bump(transfer.fromMemberId, transfer.currency, transfer.amountMinor);
    bump(transfer.toMemberId, transfer.currency, -transfer.amountMinor);
  }

  return { balances, inconsistentExpenseIds };
}

/** 各幣別的總和（資料完整時每個幣別都應該是 0） */
export function sumByCurrency(balances: MultiBalances): CurrencyAmounts {
  const sums: CurrencyAmounts = {};
  for (const row of Object.values(balances)) {
    for (const [currency, amount] of Object.entries(row)) {
      sums[currency] = (sums[currency] ?? 0) + amount;
    }
  }
  return sums;
}

/** 這個成員牽涉到的幣別（過濾掉已歸零的），照字母排序方便穩定顯示 */
export function currenciesOf(row: CurrencyAmounts | undefined): CurrencyCode[] {
  if (!row) return [];
  return Object.keys(row)
    .filter((currency) => row[currency] !== 0)
    .sort();
}

/** 測試與開發期用的不變條件檢查 */
export function assertBalanced(balances: MultiBalances): void {
  for (const [currency, sum] of Object.entries(sumByCurrency(balances))) {
    if (sum !== 0) {
      throw new Error(`${currency} 的淨額加總應為 0，實際是 ${sum}`);
    }
  }
}
