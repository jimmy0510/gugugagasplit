import {
  computeNetBalances,
  sumByCurrency,
  type ExpenseForBalance,
  type MultiBalances,
  type TransferForBalance,
} from '../balance';
import { computeDirectDebts, simplifyDebts, type Settlement } from '../settle';
import { computeSplits, PERCENT_SCALE, type SplitType } from '../split';

/**
 * 隨機化不變條件測試。
 *
 * 分帳 App 最難堪的 bug 是「大家的餘額加起來不等於 0」。
 * 多幣別模型下不變式變成「每個幣別各自加總為 0」——因為記帳完全
 * 不做匯率換算，這條在數學上必須無條件成立。
 * 用固定種子的亂數產生大量帳目反覆驗證；種子固定，失敗必可重現。
 */

const CURRENCIES = ['TWD', 'JPY', 'USD', 'EUR'] as const;

describe('隨機帳目的不變條件', () => {
  it.each([1, 7, 42, 2026])('種子 %i：200 筆隨機多幣別支出', (seed) => {
    const rng = makeRng(seed);
    const memberIds = ['m1', 'm2', 'm3', 'm4', 'm5'];

    const expenses: ExpenseForBalance[] = [];
    for (let i = 0; i < 200; i += 1) {
      expenses.push(randomExpense(`e${i}`, memberIds, rng));
    }

    const transfers: TransferForBalance[] = [];
    for (let i = 0; i < 20; i += 1) {
      const [from, to] = pickTwo(memberIds, rng);
      transfers.push({
        id: `t${i}`,
        fromMemberId: from,
        toMemberId: to,
        currency: CURRENCIES[Math.floor(rng() * CURRENCIES.length)],
        amountMinor: 1 + Math.floor(rng() * 5000),
      });
    }

    const { balances, inconsistentExpenseIds } = computeNetBalances(expenses, transfers, memberIds);

    // 1. 產生的資料本身都是完整的
    expect(inconsistentExpenseIds).toEqual([]);

    // 2. 每個幣別的淨額加總必為 0
    for (const [currency, sum] of Object.entries(sumByCurrency(balances))) {
      expect({ currency, sum }).toEqual({ currency, sum: 0 });
    }

    // 3. 每個幣別的簡化轉帳筆數不超過人數 - 1
    const simplified = simplifyDebts(balances);
    for (const currency of CURRENCIES) {
      const count = simplified.filter((s) => s.currency === currency).length;
      expect(count).toBeLessThanOrEqual(memberIds.length - 1);
    }

    // 4. 照著簡化建議轉帳，每個人每個幣別都會歸零
    expect(isAllZero(applySettlements(balances, simplified))).toBe(true);

    // 5. 直接債務雖然筆數較多，結算後同樣讓每個人歸零
    const direct = computeDirectDebts(expenses, transfers);
    expect(isAllZero(applySettlements(balances, direct))).toBe(true);
  });
});

function randomExpense(
  id: string,
  memberIds: string[],
  rng: () => number,
): ExpenseForBalance {
  const currency = CURRENCIES[Math.floor(rng() * CURRENCIES.length)];
  const totalMinor = 1 + Math.floor(rng() * 100000);

  const participants = pickSome(memberIds, rng);
  const type = (['equal', 'shares', 'percent', 'exact'] as const)[Math.floor(rng() * 4)];

  const splits = computeSplits(totalMinor, type, buildSplitInputs(type, participants, totalMinor, rng));

  const payers = pickSome(memberIds, rng);
  const payerAmounts = computeSplits(
    totalMinor,
    'shares',
    payers.map((memberId) => ({ memberId, value: 1 + Math.floor(rng() * 5) })),
  );

  return {
    id,
    currency,
    payers: payerAmounts.map((p) => ({ memberId: p.memberId, amountMinor: p.amountMinor })),
    splits: splits.map((s) => ({ memberId: s.memberId, amountMinor: s.amountMinor })),
  };
}

function buildSplitInputs(
  type: SplitType,
  participants: string[],
  totalMinor: number,
  rng: () => number,
) {
  switch (type) {
    case 'equal':
      return participants.map((memberId) => ({ memberId }));

    case 'shares':
      return participants.map((memberId) => ({ memberId, value: 1 + Math.floor(rng() * 4) }));

    case 'percent': {
      // 隨機權重轉成萬分位，最後補足差額確保總和剛好 10000
      const weights = participants.map(() => 1 + Math.floor(rng() * 10));
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      const bps = weights.map((w) => Math.floor((PERCENT_SCALE * w) / totalWeight));
      bps[0] += PERCENT_SCALE - bps.reduce((a, b) => a + b, 0);
      return participants.map((memberId, i) => ({ memberId, value: bps[i] }));
    }

    case 'exact': {
      // 用 equal 先切出合法金額，再當成指定金額餵回去
      const base = computeSplits(
        totalMinor,
        'equal',
        participants.map((memberId) => ({ memberId })),
      );
      return base.map((s) => ({ memberId: s.memberId, value: s.amountMinor }));
    }
  }
}

function pickSome(ids: string[], rng: () => number): string[] {
  const chosen = ids.filter(() => rng() < 0.6);
  return chosen.length > 0 ? chosen : [ids[Math.floor(rng() * ids.length)]];
}

function pickTwo(ids: string[], rng: () => number): [string, string] {
  const from = ids[Math.floor(rng() * ids.length)];
  const rest = ids.filter((id) => id !== from);
  return [from, rest[Math.floor(rng() * rest.length)]];
}

function applySettlements(balances: MultiBalances, settlements: Settlement[]): MultiBalances {
  const result: MultiBalances = {};
  for (const [memberId, row] of Object.entries(balances)) {
    result[memberId] = { ...row };
  }
  for (const s of settlements) {
    const from = (result[s.fromMemberId] ??= {});
    const to = (result[s.toMemberId] ??= {});
    from[s.currency] = (from[s.currency] ?? 0) + s.amountMinor;
    to[s.currency] = (to[s.currency] ?? 0) - s.amountMinor;
  }
  return result;
}

function isAllZero(balances: MultiBalances): boolean {
  return Object.values(balances).every((row) => Object.values(row).every((v) => v === 0));
}

/** mulberry32：小巧的可重現 PRNG */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
