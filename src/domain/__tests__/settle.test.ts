import {
  assertBalanced,
  computeNetBalances,
  currenciesOf,
  sumByCurrency,
  type ExpenseForBalance,
  type TransferForBalance,
} from '../balance';
import { convertMinor } from '../fx';
import { computeDirectDebts, simplifyDebts } from '../settle';

/** B 幫 A 墊了 NT$100，C 幫 B 墊了 NT$100 */
const chain: ExpenseForBalance[] = [
  {
    id: 'e1',
    currency: 'TWD',
    payers: [{ memberId: 'b', amountMinor: 100 }],
    splits: [{ memberId: 'a', amountMinor: 100 }],
  },
  {
    id: 'e2',
    currency: 'TWD',
    payers: [{ memberId: 'c', amountMinor: 100 }],
    splits: [{ memberId: 'b', amountMinor: 100 }],
  },
];

describe('computeNetBalances', () => {
  it('出錢的人淨額為正、分攤的人為負，各幣別總和為 0', () => {
    const { balances } = computeNetBalances(chain, []);
    expect(balances).toEqual({ a: { TWD: -100 }, b: { TWD: 0 }, c: { TWD: 100 } });
    expect(() => assertBalanced(balances)).not.toThrow();
  });

  it('不同幣別各自獨立記帳，互不換算', () => {
    const mixed: ExpenseForBalance[] = [
      ...chain,
      {
        id: 'e3',
        currency: 'JPY',
        payers: [{ memberId: 'a', amountMinor: 3000 }],
        splits: [{ memberId: 'c', amountMinor: 3000 }],
      },
    ];
    const { balances } = computeNetBalances(mixed, []);

    // a 在台幣欠 100，但在日圓該收 3000——兩者並列，不互相抵銷
    expect(balances.a).toEqual({ TWD: -100, JPY: 3000 });
    expect(balances.c).toEqual({ TWD: 100, JPY: -3000 });
    expect(sumByCurrency(balances)).toEqual({ TWD: 0, JPY: 0 });
  });

  it('轉帳只抵銷「債的幣別」的餘額', () => {
    const transfers: TransferForBalance[] = [
      { id: 't1', fromMemberId: 'a', toMemberId: 'c', currency: 'TWD', amountMinor: 100 },
    ];
    const { balances } = computeNetBalances(chain, transfers);
    expect(sumByCurrency(balances)).toEqual({ TWD: 0 });
    expect(currenciesOf(balances.a)).toEqual([]);
    expect(currenciesOf(balances.c)).toEqual([]);
  });

  it('沒有交易的成員也會出現在結果裡', () => {
    const { balances } = computeNetBalances([], [], ['a', 'b']);
    expect(balances).toEqual({ a: {}, b: {} });
  });

  it('出錢與分攤對不起來的支出會被跳過並回報，而不是拋錯', () => {
    // 模擬離線同步只拉到一半：payers 到了，splits 還沒到
    const halfSynced: ExpenseForBalance[] = [
      { id: 'broken', currency: 'TWD', payers: [{ memberId: 'a', amountMinor: 500 }], splits: [] },
      ...chain,
    ];
    const { balances, inconsistentExpenseIds } = computeNetBalances(halfSynced, []);

    expect(inconsistentExpenseIds).toEqual(['broken']);
    expect(sumByCurrency(balances)).toEqual({ TWD: 0 });
  });
});

describe('simplifyDebts 債務簡化', () => {
  it('A 欠 B 100、B 欠 C 100 只需要一筆 A → C', () => {
    const { balances } = computeNetBalances(chain, []);
    expect(simplifyDebts(balances)).toEqual([
      { fromMemberId: 'a', toMemberId: 'c', currency: 'TWD', amountMinor: 100 },
    ]);
  });

  it('全部結清時不需要任何轉帳', () => {
    expect(simplifyDebts({ a: { TWD: 0 }, b: {}, c: { JPY: 0 } })).toEqual([]);
  });

  it('幣別之間互不簡化：台幣債與日圓債各自出一筆', () => {
    const balances = {
      a: { TWD: -100, JPY: 3000 },
      c: { TWD: 100, JPY: -3000 },
    };
    expect(simplifyDebts(balances)).toEqual([
      { fromMemberId: 'c', toMemberId: 'a', currency: 'JPY', amountMinor: 3000 },
      { fromMemberId: 'a', toMemberId: 'c', currency: 'TWD', amountMinor: 100 },
    ]);
  });

  it('單一幣別的轉帳筆數不超過人數 - 1', () => {
    const balances = {
      a: { TWD: -300 },
      b: { TWD: -100 },
      c: { TWD: 250 },
      d: { TWD: 150 },
    };
    const settlements = simplifyDebts(balances);
    expect(settlements.length).toBeLessThanOrEqual(3);

    const after = applySettlements(balances, settlements);
    expect(sumByCurrency(after)).toEqual({ TWD: 0 });
    expect(Object.values(after).every((row) => (row.TWD ?? 0) === 0)).toBe(true);
  });

  it('金額大的優先配對，結果不受輸入順序影響', () => {
    const forward = simplifyDebts({
      a: { TWD: -300 },
      b: { TWD: -100 },
      c: { TWD: 250 },
      d: { TWD: 150 },
    });
    const shuffled = simplifyDebts({
      d: { TWD: 150 },
      b: { TWD: -100 },
      c: { TWD: 250 },
      a: { TWD: -300 },
    });
    expect(shuffled).toEqual(forward);
  });
});

describe('computeDirectDebts 直接債務', () => {
  it('保留原本的債務關係，不做簡化', () => {
    expect(computeDirectDebts(chain, [])).toEqual([
      { fromMemberId: 'a', toMemberId: 'b', currency: 'TWD', amountMinor: 100 },
      { fromMemberId: 'b', toMemberId: 'c', currency: 'TWD', amountMinor: 100 },
    ]);
  });

  it('同幣別的雙向債務互相抵銷', () => {
    const mutual: ExpenseForBalance[] = [
      {
        id: 'e1',
        currency: 'TWD',
        payers: [{ memberId: 'a', amountMinor: 300 }],
        splits: [{ memberId: 'b', amountMinor: 300 }],
      },
      {
        id: 'e2',
        currency: 'TWD',
        payers: [{ memberId: 'b', amountMinor: 100 }],
        splits: [{ memberId: 'a', amountMinor: 100 }],
      },
    ];
    expect(computeDirectDebts(mutual, [])).toEqual([
      { fromMemberId: 'b', toMemberId: 'a', currency: 'TWD', amountMinor: 200 },
    ]);
  });

  it('不同幣別的雙向債務「不」互相抵銷', () => {
    const crossCurrency: ExpenseForBalance[] = [
      {
        id: 'e1',
        currency: 'TWD',
        payers: [{ memberId: 'a', amountMinor: 300 }],
        splits: [{ memberId: 'b', amountMinor: 300 }],
      },
      {
        id: 'e2',
        currency: 'JPY',
        payers: [{ memberId: 'b', amountMinor: 1000 }],
        splits: [{ memberId: 'a', amountMinor: 1000 }],
      },
    ];
    expect(computeDirectDebts(crossCurrency, [])).toEqual([
      { fromMemberId: 'a', toMemberId: 'b', currency: 'JPY', amountMinor: 1000 },
      { fromMemberId: 'b', toMemberId: 'a', currency: 'TWD', amountMinor: 300 },
    ]);
  });

  it('多人共同付款時，在該筆支出內部配對，金額不掉零頭', () => {
    const expense: ExpenseForBalance = {
      id: 'e1',
      currency: 'TWD',
      payers: [
        { memberId: 'a', amountMinor: 70 },
        { memberId: 'b', amountMinor: 30 },
      ],
      splits: [
        { memberId: 'c', amountMinor: 50 },
        { memberId: 'd', amountMinor: 50 },
      ],
    };
    const direct = computeDirectDebts([expense], []);
    const total = direct.reduce((sum, s) => sum + s.amountMinor, 0);

    // 配對是「金額大的先配」而不是等比例，所以是 3 筆而非 4 筆
    expect(total).toBe(100);
    expect(direct).toEqual([
      { fromMemberId: 'c', toMemberId: 'a', currency: 'TWD', amountMinor: 50 },
      { fromMemberId: 'd', toMemberId: 'a', currency: 'TWD', amountMinor: 20 },
      { fromMemberId: 'd', toMemberId: 'b', currency: 'TWD', amountMinor: 30 },
    ]);
  });

  it('自己付自己的部分不會產生欠款', () => {
    const expense: ExpenseForBalance = {
      id: 'e1',
      currency: 'TWD',
      payers: [{ memberId: 'a', amountMinor: 100 }],
      splits: [
        { memberId: 'a', amountMinor: 50 },
        { memberId: 'b', amountMinor: 50 },
      ],
    };
    expect(computeDirectDebts([expense], [])).toEqual([
      { fromMemberId: 'b', toMemberId: 'a', currency: 'TWD', amountMinor: 50 },
    ]);
  });
});

describe('清算時的跨幣別還款', () => {
  it('用台幣付日圓債：餘額只動日圓，實付金額只是紀錄', () => {
    const expenses: ExpenseForBalance[] = [
      {
        id: 'e1',
        currency: 'JPY',
        payers: [{ memberId: 'b', amountMinor: 3000 }],
        splits: [{ memberId: 'a', amountMinor: 3000 }],
      },
    ];

    // 清算畫面：使用者自己填匯率 0.21，系統建議實付 NT$630（純參考）
    expect(convertMinor(3000, 'JPY', 'TWD', 0.21)).toBe(630);

    // 實際入帳的轉帳記在「債的幣別」上
    const transfers: TransferForBalance[] = [
      { id: 't1', fromMemberId: 'a', toMemberId: 'b', currency: 'JPY', amountMinor: 3000 },
    ];

    const { balances } = computeNetBalances(expenses, transfers);
    expect(currenciesOf(balances.a)).toEqual([]);
    expect(currenciesOf(balances.b)).toEqual([]);
  });
});

function applySettlements(
  balances: Record<string, Record<string, number>>,
  settlements: { fromMemberId: string; toMemberId: string; currency: string; amountMinor: number }[],
): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
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
