import {
  sumByCurrency,
  type CurrencyAmounts,
  type ExpenseForBalance,
  type MultiBalances,
  type TransferForBalance,
} from './balance';
import { type CurrencyCode, type Minor } from './money';

/**
 * 一筆結算建議。金額與幣別是「債」本身的——實際用什麼幣別付、
 * 用什麼匯率換，是清算當下使用者自己決定的事（記在 transfer 的 paid_* 欄位）。
 */
export interface Settlement {
  fromMemberId: string;
  toMemberId: string;
  currency: CurrencyCode;
  amountMinor: Minor;
}

/**
 * 債務簡化（min cash flow），逐幣別獨立進行。
 *
 * 在每個幣別內：反覆把「欠最多的人」配給「該收最多的人」，
 * 轉帳金額取兩者較小值。每配一次至少有一方歸零，
 * 所以單一幣別最多產生 n-1 筆轉帳。
 *
 * 幣別之間互不簡化——「用台幣債抵日圓債」需要匯率，
 * 那是清算當下由使用者自己決定的事，不是演算法能替他們做的主。
 */
export function simplifyDebts(balances: MultiBalances): Settlement[] {
  const settlements: Settlement[] = [];

  for (const currency of Object.keys(sumByCurrency(balances)).sort()) {
    const net: Record<string, Minor> = {};
    for (const [memberId, row] of Object.entries(balances)) {
      const amount = row[currency] ?? 0;
      if (amount !== 0) net[memberId] = amount;
    }
    settlements.push(...simplifyOneCurrency(net, currency));
  }

  return settlements;
}

function simplifyOneCurrency(net: Record<string, Minor>, currency: CurrencyCode): Settlement[] {
  const debtors = Object.entries(net)
    .filter(([, amount]) => amount < 0)
    .map(([memberId, amount]) => ({ memberId, amount: -amount }))
    .sort(byAmountDescThenId);

  const creditors = Object.entries(net)
    .filter(([, amount]) => amount > 0)
    .map(([memberId, amount]) => ({ memberId, amount }))
    .sort(byAmountDescThenId);

  const settlements: Settlement[] = [];
  let d = 0;
  let c = 0;

  while (d < debtors.length && c < creditors.length) {
    const amount = Math.min(debtors[d].amount, creditors[c].amount);

    settlements.push({
      fromMemberId: debtors[d].memberId,
      toMemberId: creditors[c].memberId,
      currency,
      amountMinor: amount,
    });

    debtors[d].amount -= amount;
    creditors[c].amount -= amount;

    if (debtors[d].amount === 0) d += 1;
    if (creditors[c].amount === 0) c += 1;
  }

  return settlements;
}

/**
 * 直接債務：不跨支出簡化，逐筆支出算出「誰直接欠誰」，逐幣別累計。
 *
 * 有些人不喜歡把錢轉給沒跟自己吃過飯的人，所以畫面上兩種檢視都提供。
 *
 * 作法是在「單筆支出內部」做一次配對：先算出這筆支出裡每個人的淨額
 * （墊的錢減掉該分攤的），再用與 simplifyDebts 相同的貪婪配對消掉。
 * 每筆支出的淨額本來就精確加總為 0，配對只是把它拆成轉帳，
 * 所以不會有四捨五入的零頭跑掉。
 */
export function computeDirectDebts(
  expenses: ExpenseForBalance[],
  transfers: TransferForBalance[],
): Settlement[] {
  // matrix[債務人][債權人][幣別] = 金額
  const matrix = new Map<string, Map<string, CurrencyAmounts>>();

  const add = (from: string, to: string, currency: CurrencyCode, amount: Minor) => {
    if (from === to || amount === 0) return;
    const row = matrix.get(from) ?? new Map<string, CurrencyAmounts>();
    const cell = row.get(to) ?? {};
    cell[currency] = (cell[currency] ?? 0) + amount;
    row.set(to, cell);
    matrix.set(from, row);
  };

  for (const expense of expenses) {
    const net: Record<string, Minor> = {};
    const bump = (memberId: string, delta: Minor) => {
      net[memberId] = (net[memberId] ?? 0) + delta;
    };

    for (const payer of expense.payers) bump(payer.memberId, payer.amountMinor);
    for (const split of expense.splits) bump(split.memberId, -split.amountMinor);

    // 半套資料直接跳過，理由同 computeNetBalances
    if (Object.values(net).reduce((a, b) => a + b, 0) !== 0) continue;

    for (const s of simplifyOneCurrency(net, expense.currency)) {
      add(s.fromMemberId, s.toMemberId, s.currency, s.amountMinor);
    }
  }

  // 還款方向與欠款相反，加在反向即可抵銷（只影響債的幣別）
  for (const transfer of transfers) {
    add(transfer.toMemberId, transfer.fromMemberId, transfer.currency, transfer.amountMinor);
  }

  return netOutMatrix(matrix);
}

/** 把 A 欠 B 與 B 欠 A 逐幣別互相抵銷，只留下淨值方向 */
function netOutMatrix(matrix: Map<string, Map<string, CurrencyAmounts>>): Settlement[] {
  const settlements: Settlement[] = [];
  const done = new Set<string>();

  const members = [...matrix.keys()].sort();

  for (const from of members) {
    for (const to of [...(matrix.get(from)?.keys() ?? [])].sort()) {
      const pairKey = from < to ? `${from}|${to}` : `${to}|${from}`;
      if (done.has(pairKey)) continue;
      done.add(pairKey);

      const forward = matrix.get(from)?.get(to) ?? {};
      const backward = matrix.get(to)?.get(from) ?? {};
      const currencies = [...new Set([...Object.keys(forward), ...Object.keys(backward)])].sort();

      for (const currency of currencies) {
        const net = (forward[currency] ?? 0) - (backward[currency] ?? 0);
        if (net > 0) {
          settlements.push({ fromMemberId: from, toMemberId: to, currency, amountMinor: net });
        } else if (net < 0) {
          settlements.push({ fromMemberId: to, toMemberId: from, currency, amountMinor: -net });
        }
      }
    }
  }

  return settlements;
}

function byAmountDescThenId(
  a: { memberId: string; amount: Minor },
  b: { memberId: string; amount: Minor },
): number {
  return b.amount - a.amount || (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0);
}
