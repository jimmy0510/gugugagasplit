import { assertSafeMinor, exponentOf, type CurrencyCode, type Minor } from './money';

/**
 * 匯率換算小工具。
 *
 * 注意定位：記帳「不做」任何換算——支出用自己的幣別記，餘額分幣別顯示。
 * 這個函式只在清算畫面用：使用者填入他們自己講好的匯率後，
 * 幫他算「¥3,000 依 0.21 大約是 NT$630」這種建議實付金額。
 * 算出來的數字只是給人看的參考，不會回頭改動任何幣別的餘額。
 *
 * rate 的定義：1 單位 from（主單位）可換得多少 to（主單位）。
 * 換算時一併處理兩種幣別小數位數的差異：JPY(0 位) 換 USD(2 位)
 * 還要再乘上 10^(2-0)。最後四捨五入成整數（.5 一律遠離 0）。
 */
export function convertMinor(
  amountMinor: Minor,
  from: CurrencyCode,
  to: CurrencyCode,
  rate: number,
): Minor {
  assertSafeMinor(amountMinor);

  if (from.toUpperCase() === to.toUpperCase()) {
    return amountMinor;
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`匯率必須是正數，收到 ${rate}`);
  }

  const scaleShift = 10 ** (exponentOf(to) - exponentOf(from));
  const converted = roundHalfAwayFromZero(amountMinor * rate * scaleShift);

  assertSafeMinor(converted, '換算後金額');
  return converted;
}

/** Math.round(-0.5) 會得到 -0（往上取），這裡統一成「.5 遠離 0」 */
export function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}
