/**
 * 金額一律以「最小單位整數」表示（TWD/JPY 用元，USD 用分）。
 * 全程不用浮點數做加減，避免 0.1 + 0.2 !== 0.3 這類誤差污染帳目。
 */

export type CurrencyCode = string;

/** 最小單位整數。例如 USD 1.23 => 123；TWD 100 => 100 */
export type Minor = number;

const DEFAULT_EXPONENT = 2;

/**
 * 幣別小數位數。
 *
 * 注意：TWD 在 ISO 4217 上其實是 2 位（分），但台灣實務上不使用分——
 * NT$100 分 3 人應該是 34/33/33，而不是 33.34/33.33/33.33，
 * 所以這裡刻意設為 0。這是有意識的偏離，不是漏掉。
 */
const EXPONENTS: Record<string, number> = {
  TWD: 0,
  JPY: 0,
  KRW: 0,
  VND: 0,
  IDR: 0,
  CLP: 0,
  ISK: 0,
  USD: 2,
  EUR: 2,
  GBP: 2,
  CNY: 2,
  HKD: 2,
  SGD: 2,
  AUD: 2,
  CAD: 2,
  CHF: 2,
  NZD: 2,
  THB: 2,
  MYR: 2,
  PHP: 2,
  INR: 2,
  BHD: 3,
  JOD: 3,
  KWD: 3,
  OMR: 3,
  TND: 3,
};

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

export function exponentOf(code: CurrencyCode): number {
  return EXPONENTS[code.toUpperCase()] ?? DEFAULT_EXPONENT;
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
 * 多出來的位數四捨五入，例如 USD 的 "1.235" => 124。
 */
export function parseMoney(input: string, code: CurrencyCode): Minor {
  const exponent = exponentOf(code);
  const cleaned = input.trim().replace(/[,\s_]/g, '');

  if (!/^-?\d*(\.\d*)?$/.test(cleaned) || !/\d/.test(cleaned)) {
    throw new Error(`無法解析金額：${input}`);
  }

  const negative = cleaned.startsWith('-');
  const body = negative ? cleaned.slice(1) : cleaned;
  const [intPart, fracPart = ''] = body.split('.');

  const kept = fracPart.slice(0, exponent).padEnd(exponent, '0');
  let minor = Number(`${intPart || '0'}${kept}`);

  // 第一個被捨去的位數 >= 5 就進位
  const nextDigit = fracPart.charAt(exponent);
  if (nextDigit !== '' && nextDigit >= '5') {
    minor += 1;
  }

  assertSafeMinor(minor);
  return negative ? -minor : minor;
}

/** 123456 (USD) => "1,234.56"；100 (TWD) => "100" */
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
