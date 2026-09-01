import { formatMoney, parseMoney } from '../money';
import { allocate, computeSplits, PERCENT_SCALE, type SplitInput } from '../split';

const members = (...ids: string[]): SplitInput[] => ids.map((memberId) => ({ memberId }));
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe('allocate 最大餘數法', () => {
  it('除不盡時加總仍剛好等於總額', () => {
    const result = allocate(10000, [1, 1, 1]);
    expect(result).toEqual([3334, 3333, 3333]);
    expect(sum(result)).toBe(10000);
  });

  it('餘數優先給比例小數部分大的人', () => {
    // 100 依 1:1:1 分 → 每人 33.33...，三人餘數相同，索引小的先拿
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    // 10 依 1:2:3 分 → 1.67 / 3.33 / 5，餘數 4/2/0，第一位先拿
    expect(allocate(10, [1, 2, 3])).toEqual([2, 3, 5]);
  });

  it('權重為 0 的人分到 0', () => {
    expect(allocate(100, [0, 1, 1])).toEqual([0, 50, 50]);
  });

  it('負數總額同樣精確', () => {
    const result = allocate(-100, [1, 1, 1]);
    expect(sum(result)).toBe(-100);
  });

  it('拒絕不合法的權重', () => {
    expect(() => allocate(100, [])).toThrow();
    expect(() => allocate(100, [0, 0])).toThrow();
    expect(() => allocate(100, [-1, 2])).toThrow();
    expect(() => allocate(100, [1.5, 1])).toThrow();
  });
});

describe('computeSplits', () => {
  it('平均分：100.00 分 3 人 = 33.34 / 33.33 / 33.33', () => {
    const result = computeSplits(10000, 'equal', members('a', 'b', 'c'));
    expect(result).toEqual([
      { memberId: 'a', amountMinor: 3334 },
      { memberId: 'b', amountMinor: 3333 },
      { memberId: 'c', amountMinor: 3333 },
    ]);
    expect(sum(result.map((r) => r.amountMinor))).toBe(10000);
  });

  /**
   * 從使用者打的字一路走到畫面上的字。
   *
   * 中間任何一段偷偷改回整數（幣別小數位數、輸入解析、顯示格式）都會被這裡抓到——
   * 曾經 TWD 是 0 位，NT$100 分 3 人只能 34/33/33，固定有人多付一塊。
   */
  it('平分算到分：NT$100 分 3 人 = 33.34 / 33.33 / 33.33', () => {
    const total = parseMoney('100', 'TWD');
    const result = computeSplits(total, 'equal', members('a', 'b', 'c'));

    expect(result.map((r) => formatMoney(r.amountMinor, 'TWD'))).toEqual([
      '33.34',
      '33.33',
      '33.33',
    ]);
    expect(sum(result.map((r) => r.amountMinor))).toBe(total);
  });

  it('平分算到分：¥1,000 分 3 人也切到小數', () => {
    const total = parseMoney('1000', 'JPY');
    const result = computeSplits(total, 'equal', members('a', 'b', 'c'));

    expect(result.map((r) => formatMoney(r.amountMinor, 'JPY'))).toEqual([
      '333.34',
      '333.33',
      '333.33',
    ]);
    expect(sum(result.map((r) => r.amountMinor))).toBe(total);
  });

  it('依權重：情侶算 2、單身算 1', () => {
    const result = computeSplits(1000, 'shares', [
      { memberId: 'couple', value: 2 },
      { memberId: 'solo1', value: 1 },
      { memberId: 'solo2', value: 1 },
    ]);
    const byId = Object.fromEntries(result.map((r) => [r.memberId, r.amountMinor]));
    expect(byId.couple).toBe(500);
    expect(byId.solo1).toBe(250);
    expect(byId.solo2).toBe(250);
  });

  it('依百分比：萬分位總和必須是 100%', () => {
    const result = computeSplits(10000, 'percent', [
      { memberId: 'a', value: 3333 },
      { memberId: 'b', value: 3333 },
      { memberId: 'c', value: 3334 },
    ]);
    expect(sum(result.map((r) => r.amountMinor))).toBe(10000);

    expect(() =>
      computeSplits(10000, 'percent', [
        { memberId: 'a', value: 5000 },
        { memberId: 'b', value: 4000 },
      ]),
    ).toThrow(/100%/);
  });

  it('依指定金額：總和不符就拋錯', () => {
    const ok = computeSplits(1000, 'exact', [
      { memberId: 'a', value: 600 },
      { memberId: 'b', value: 400 },
    ]);
    expect(sum(ok.map((r) => r.amountMinor))).toBe(1000);

    expect(() =>
      computeSplits(1000, 'exact', [
        { memberId: 'a', value: 600 },
        { memberId: 'b', value: 300 },
      ]),
    ).toThrow(/不符/);
  });

  it('輸入順序不影響結果（跨裝置一致性）', () => {
    const forward = computeSplits(10000, 'equal', members('a', 'b', 'c'));
    const backward = computeSplits(10000, 'equal', members('c', 'b', 'a'));
    expect(backward).toEqual(forward);
  });

  it('成員重複時拋錯', () => {
    expect(() => computeSplits(100, 'equal', members('a', 'a'))).toThrow(/重複/);
  });

  it('PERCENT_SCALE 是萬分位', () => {
    expect(PERCENT_SCALE).toBe(10000);
  });
});
