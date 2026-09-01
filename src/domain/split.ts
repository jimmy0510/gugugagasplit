import { assertSafeMinor, type Minor } from './money';

export type SplitType = 'equal' | 'shares' | 'percent' | 'exact';

export interface SplitInput {
  memberId: string;
  /**
   * shares  → 整數權重（情侶算 2、單身算 1）
   * percent → 萬分位整數，總和必須是 10000（33.33% = 3333）
   * exact   → 最小單位金額，總和必須等於總額
   * equal   → 忽略
   */
  value?: number;
}

export interface SplitResult {
  memberId: string;
  amountMinor: Minor;
}

/** percent 用萬分位表示，總和必為此值 */
export const PERCENT_SCALE = 10000;

/**
 * 最大餘數法（largest remainder method）。
 *
 * 把 total 依 weights 比例拆成整數，保證回傳陣列加總「剛好」等於 total，
 * 不會因為四捨五入而少一分或多一分。餘數大的先拿到多出來的那一單位，
 * 同分時取索引小的，所以只要輸入順序一致，每台裝置都算出相同結果。
 */
export function allocate(total: Minor, weights: number[]): Minor[] {
  assertSafeMinor(total, '總額');

  if (weights.length === 0) {
    throw new Error('至少要有一個分攤對象');
  }
  if (weights.some((w) => !Number.isInteger(w) || w < 0)) {
    throw new Error('權重必須是非負整數');
  }

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight <= 0) {
    throw new Error('權重總和必須大於 0');
  }

  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);

  if (!Number.isSafeInteger(abs * totalWeight)) {
    throw new Error('金額與權重相乘後超出安全整數範圍');
  }

  const base = weights.map((w) => Math.floor((abs * w) / totalWeight));
  const remainders = weights.map((w, i) => abs * w - base[i] * totalWeight);

  let leftover = abs - base.reduce((sum, v) => sum + v, 0);

  const order = remainders
    .map((remainder, index) => ({ remainder, index }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  const result = [...base];
  for (const { index } of order) {
    if (leftover <= 0) break;
    result[index] += 1;
    leftover -= 1;
  }

  return result.map((v) => v * sign);
}

/**
 * 依分帳方式算出每個人該分攤多少。
 * 一律先依 memberId 排序再分配，確保任何裝置、任何輸入順序都得到相同結果。
 */
export function computeSplits(
  totalMinor: Minor,
  type: SplitType,
  inputs: SplitInput[],
): SplitResult[] {
  if (inputs.length === 0) {
    throw new Error('至少要有一個分攤對象');
  }

  const seen = new Set<string>();
  for (const input of inputs) {
    if (seen.has(input.memberId)) {
      throw new Error(`成員重複出現：${input.memberId}`);
    }
    seen.add(input.memberId);
  }

  const sorted = [...inputs].sort((a, b) =>
    a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0,
  );

  const zip = (amounts: Minor[]): SplitResult[] =>
    sorted.map((input, i) => ({ memberId: input.memberId, amountMinor: amounts[i] }));

  switch (type) {
    case 'equal':
      return zip(allocate(totalMinor, sorted.map(() => 1)));

    case 'shares': {
      const weights = sorted.map((input) => requireIntValue(input, 'shares'));
      if (weights.every((w) => w === 0)) {
        throw new Error('權重不可以全部為 0');
      }
      return zip(allocate(totalMinor, weights));
    }

    case 'percent': {
      const bps = sorted.map((input) => requireIntValue(input, 'percent'));
      const sum = bps.reduce((a, b) => a + b, 0);
      if (sum !== PERCENT_SCALE) {
        throw new Error(`百分比總和必須是 100%，目前是 ${(sum / 100).toFixed(2)}%`);
      }
      return zip(allocate(totalMinor, bps));
    }

    case 'exact': {
      const amounts = sorted.map((input) => requireIntValue(input, 'exact', true));
      const sum = amounts.reduce((a, b) => a + b, 0);
      if (sum !== totalMinor) {
        throw new Error(`指定金額總和 ${sum} 與總額 ${totalMinor} 不符`);
      }
      return zip(amounts);
    }
  }
}

function requireIntValue(input: SplitInput, type: SplitType, allowNegative = false): number {
  const value = input.value;

  if (value === undefined || !Number.isInteger(value)) {
    throw new Error(`${type} 分帳需要每個人的整數值，成員 ${input.memberId} 缺少或不是整數`);
  }
  if (!allowNegative && value < 0) {
    throw new Error(`${type} 分帳的值不可為負數，成員 ${input.memberId} 是 ${value}`);
  }

  return value;
}
