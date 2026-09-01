import { exponentOf, formatMoney, formatWithCurrency, parseMoney } from '../money';

describe('幣別小數位數', () => {
  // 不分幣別一律兩位：同一群組裡兩種精度會讓零頭永遠分不乾淨
  it('每種幣別都是兩位', () => {
    expect(exponentOf('TWD')).toBe(2);
    expect(exponentOf('JPY')).toBe(2);
    expect(exponentOf('USD')).toBe(2);
  });

  it('沒收錄的幣別也是兩位', () => {
    expect(exponentOf('XYZ')).toBe(2);
  });
});

describe('parseMoney', () => {
  it('轉成最小單位（小數點後第二位）', () => {
    expect(parseMoney('1234.56', 'USD')).toBe(123456);
    expect(parseMoney('1234', 'TWD')).toBe(123400);
    // 逗號不是千位分隔，是加號——見下面那條測試
  });

  it('位數不足時補零', () => {
    expect(parseMoney('1.5', 'USD')).toBe(150);
    expect(parseMoney('.5', 'USD')).toBe(50);
  });

  it('多出來的位數四捨五入', () => {
    expect(parseMoney('1.235', 'USD')).toBe(124);
    expect(parseMoney('1.234', 'USD')).toBe(123);
    expect(parseMoney('99.6', 'TWD')).toBe(9960);
    expect(parseMoney('99.446', 'TWD')).toBe(9945);
  });

  /**
   * 分帳現場最常見的是「我的 120 加他那份 80」，讓人先去按計算機很煩。
   * 每一項各自換算再相加，所以不會有 0.1+0.2 那種誤差。
   */
  it('吃加減式', () => {
    expect(parseMoney('20+20', 'TWD')).toBe(4000);
    // 手機數字鍵盤沒有 + 鍵，逗號是上面唯一多的符號，就拿它當加號
    expect(parseMoney('20,20', 'TWD')).toBe(4000);
    expect(parseMoney('1,234', 'TWD')).toBe(23500);
    expect(parseMoney('20 + 20 + 5.5', 'TWD')).toBe(4550);
    expect(parseMoney('100-5.5', 'TWD')).toBe(9450);
    expect(parseMoney('0.1+0.2', 'TWD')).toBe(30);
    // 還沒打完的式子先當成已經打好的那部分，不要在打字途中就跳錯誤
    expect(parseMoney('20+', 'TWD')).toBe(2000);
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
  it('還原顯示', () => {
    expect(formatMoney(123456, 'USD')).toBe('1,234.56');
    expect(formatMoney(123400, 'TWD')).toBe('1,234.00');
    expect(formatMoney(5, 'USD')).toBe('0.05');
    expect(formatMoney(0, 'USD')).toBe('0.00');
  });

  it('負數帶負號', () => {
    expect(formatMoney(-1234, 'TWD')).toBe('-12.34');
    expect(formatWithCurrency(-1234, 'TWD')).toBe('-NT$12.34');
  });

  /**
   * 顯示會加千位逗號，但逗號在輸入時是加號，所以往回餵之前要先去掉——
   * 畫面上把既有金額填回欄位時也是這樣做的。
   */
  it('parse 與 format 互為反向', () => {
    for (const [text, code] of [
      ['1,234.56', 'USD'],
      ['0.07', 'USD'],
      ['98,765.00', 'TWD'],
      ['3,000.00', 'JPY'],
    ] as const) {
      expect(formatMoney(parseMoney(text.replace(/,/g, ''), code), code)).toBe(text);
    }
  });
});
