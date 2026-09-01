import { exponentOf, formatMoney, formatWithCurrency, parseMoney } from '../money';

describe('幣別小數位數', () => {
  it('TWD 與 JPY 沒有小數位，USD 有兩位', () => {
    expect(exponentOf('TWD')).toBe(0);
    expect(exponentOf('JPY')).toBe(0);
    expect(exponentOf('USD')).toBe(2);
  });

  it('沒收錄的幣別預設兩位', () => {
    expect(exponentOf('XYZ')).toBe(2);
  });
});

describe('parseMoney', () => {
  it('依幣別轉成最小單位', () => {
    expect(parseMoney('1234.56', 'USD')).toBe(123456);
    expect(parseMoney('1234', 'TWD')).toBe(1234);
    expect(parseMoney('1,234', 'TWD')).toBe(1234);
  });

  it('位數不足時補零', () => {
    expect(parseMoney('1.5', 'USD')).toBe(150);
    expect(parseMoney('.5', 'USD')).toBe(50);
  });

  it('多出來的位數四捨五入', () => {
    expect(parseMoney('1.235', 'USD')).toBe(124);
    expect(parseMoney('1.234', 'USD')).toBe(123);
    expect(parseMoney('99.6', 'TWD')).toBe(100);
    expect(parseMoney('99.4', 'TWD')).toBe(99);
  });

  it('處理負數', () => {
    expect(parseMoney('-12.34', 'USD')).toBe(-1234);
  });

  it('無法解析時拋錯', () => {
    expect(() => parseMoney('abc', 'TWD')).toThrow();
    expect(() => parseMoney('', 'TWD')).toThrow();
    expect(() => parseMoney('1.2.3', 'TWD')).toThrow();
  });
});

describe('formatMoney', () => {
  it('依幣別還原顯示', () => {
    expect(formatMoney(123456, 'USD')).toBe('1,234.56');
    expect(formatMoney(1234, 'TWD')).toBe('1,234');
    expect(formatMoney(5, 'USD')).toBe('0.05');
    expect(formatMoney(0, 'USD')).toBe('0.00');
  });

  it('負數帶負號', () => {
    expect(formatMoney(-1234, 'TWD')).toBe('-1,234');
    expect(formatWithCurrency(-1234, 'TWD')).toBe('-NT$1,234');
  });

  it('parse 與 format 互為反向', () => {
    for (const [text, code] of [
      ['1,234.56', 'USD'],
      ['0.07', 'USD'],
      ['98,765', 'TWD'],
    ] as const) {
      expect(formatMoney(parseMoney(text, code), code)).toBe(text);
    }
  });
});
