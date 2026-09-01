/**
 * 金額一律以「最小單位整數」表示，最小單位是小數點後第二位（NT$1.23 => 123）。
 * 全程不用浮點數做加減，避免 0.1 + 0.2 !== 0.3 這類誤差污染帳目。
 */

export type CurrencyCode = string;

/** 最小單位整數。例如 1.23 => 123；100 => 10000 */
export type Minor = number;

/**
 * 小數位數一律兩位，不分幣別。
 *
 * 原本是照各幣別實務走：TWD/JPY 記到元、USD 記到分。結果是同一個群組裡
 * 有兩種精度，日圓那筆永遠分不出零頭，而且 NT$100 分 3 人只能 34/33/33，
 * 有人固定多付一塊。改成全部記到小數點後第二位——多的位數用不到就是 .00，
 * 需要的時候分得乾淨。
 *
 * 這個數字改動會改變資料庫裡所有金額的意義（存的是「幾個最小單位」），
 * 要動的話得同時寫一支 ×10^差額 的資料轉換，見 migration 0011。
 */
const EXPONENT = 2;

const SYMBOLS: Record<string, string> = {
  TWD: 'NT$',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: 'CN¥',
  KRW: '₩',
  HKD: 'HK$',
  SGD: 'S$',
  THB: '฿',
  VND: '₫',
  PHP: '₱',
  INR: '₹',
};

/** 幣別選單用。台灣人最常用的排前面，其餘照字母序。 */
export const COMMON_CURRENCIES: CurrencyCode[] = [
  'TWD',
  'JPY',
  'USD',
  'KRW',
  'EUR',
  'CNY',
  'HKD',
  'SGD',
  'THB',
  'GBP',
  'AUD',
  'CAD',
  'CHF',
  'MYR',
  'NZD',
  'PHP',
  'VND',
];

export function exponentOf(_code: CurrencyCode): number {
  return EXPONENT;
}

export function symbolOf(code: CurrencyCode): string {
  return SYMBOLS[code.toUpperCase()] ?? `${code.toUpperCase()} `;
}

export function assertSafeMinor(value: number, label = '金額'): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${label}必須是整數最小單位，收到 ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label}超出安全整數範圍：${value}`);
  }
}

/**
 * 把使用者輸入的字串轉成最小單位整數。
 * 多出來的位數四捨五入，例如 "1.235" => 124。
 *
 * 也吃 "20+20" 這種加減式。分帳現場常常是「我這份 120 再加他的 80」，
 * 要人先開計算機算完再回來填很煩。每一項各自換算成最小單位後才相加，
 * 全程還是整數運算，不會有浮點誤差。
 *
 * 逗號一律當成加號。手機的數字鍵盤沒有 + 鍵，換成電話鍵盤又會少掉小數點，
 * 而逗號是數字鍵盤上唯一多出來的符號——與其在畫面上多放一顆按鈕，
 * 不如直接讓它當加號用。代價是 "1,234" 會變成 1+234=235，不再是千位分隔；
 * App 自己填進欄位的值都已經先把逗號去掉了，只有手動輸入才碰得到。
 */
export function parseMoney(input: string, code: CurrencyCode): Minor {
  const exponent = exponentOf(code);
  const cleaned = input.trim().replace(/[\s_]/g, '').replace(/,/g, '+');

  if (!/^[+-]?\d*(\.\d*)?([+-]\d*(\.\d*)?)*$/.test(cleaned) || !/\d/.test(cleaned)) {
    throw new Error(`無法解析金額：${input}`);
  }

  let total = 0;
  for (const term of cleaned.match(/[+-]?[\d.]+/g) ?? []) {
    total += parseTerm(term, exponent);
  }

  assertSafeMinor(total);
  return total;
}

/** 加減式裡的單獨一項，例如 "20"、"+3.5"、"-0.75" */
function parseTerm(term: string, exponent: number): Minor {
  const negative = term.startsWith('-');
  const [intPart, fracPart = ''] = term.replace(/^[+-]/, '').split('.');

  const kept = fracPart.slice(0, exponent).padEnd(exponent, '0');
  let minor = Number(`${intPart || '0'}${kept}`);

  // 第一個被捨去的位數 >= 5 就進位
  const nextDigit = fracPart.charAt(exponent);
  if (nextDigit !== '' && nextDigit >= '5') {
    minor += 1;
  }

  return negative ? -minor : minor;
}

/** 123456 => "1,234.56"；100 => "1.00" */
export function formatMoney(minor: Minor, code: CurrencyCode): string {
  assertSafeMinor(minor);

  const exponent = exponentOf(code);
  const sign = minor < 0 ? '-' : '';
  const digits = Math.abs(minor).toString().padStart(exponent + 1, '0');

  const intPart = digits.slice(0, digits.length - exponent);
  const fracPart = exponent > 0 ? `.${digits.slice(digits.length - exponent)}` : '';
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return `${sign}${grouped}${fracPart}`;
}

/** 帶幣別符號，例如 "NT$1,200"、"-$12.34" */
export function formatWithCurrency(minor: Minor, code: CurrencyCode): string {
  return `${minor < 0 ? '-' : ''}${symbolOf(code)}${formatMoney(Math.abs(minor), code)}`;
}
