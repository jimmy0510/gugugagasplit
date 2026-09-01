/**
 * 拖曳換位的算術。
 *
 * 抽成純函式是因為這裡最容易錯得無聲無息——差一格、少一個間距，
 * 畫面看起來只是「有點怪」，不會壞掉，卻很難從畫面上除錯。
 * 這樣就能直接用數字驗證，不必靠手拖。
 *
 * 所有位置都以「拖曳開始那一刻的排列」為基準，單位是像素。
 */

/** 第 index 顆在原本排列下的左緣 */
export function offsetOf(widths: number[], gap: number, index: number): number {
  let x = 0;
  for (let k = 0; k < index; k += 1) x += (widths[k] ?? 0) + gap;
  return x;
}

/** 把第 from 顆拿掉之後，第 to 個位置的左緣——放手後它該停在哪 */
export function slotOf(widths: number[], gap: number, from: number, to: number): number {
  let x = 0;
  let seen = 0;
  for (let k = 0; k < widths.length && seen < to; k += 1) {
    if (k === from) continue;
    x += (widths[k] ?? 0) + gap;
    seen += 1;
  }
  return x;
}

/**
 * 拖到 dx 這個位移時，放手會插進第幾格。
 *
 * 規則：被拖的那顆的中心，越過誰原本的中心，就排到誰後面。
 * 用中心而不是邊緣，換位的時機才會跟手感一致。
 *
 * 兩邊都必須用「原本的排列」量。第一版拿被拖那顆的原位中心去比
 * 「把它抽掉之後其他顆的中心」，兩套座標混在一起——手指還沒動，
 * 中間那顆就已經被判定越過了右邊的鄰居，一放手就自己跳一格。
 */
export function targetFor(widths: number[], gap: number, from: number, dx: number): number {
  const center = offsetOf(widths, gap, from) + dx + (widths[from] ?? 0) / 2;
  let index = 0;
  for (let k = 0; k < widths.length; k += 1) {
    if (k === from) continue;
    if (center > offsetOf(widths, gap, k) + (widths[k] ?? 0) / 2) index += 1;
  }
  return index;
}

/** 為了讓被拖的那顆有地方去，夾在中間的其他顆要往哪邊挪多少 */
export function shiftFor(
  index: number,
  drag: { from: number; to: number } | null,
  draggedWidth: number,
): number {
  if (!drag || index === drag.from) return 0;
  if (drag.from < drag.to && index > drag.from && index <= drag.to) return -draggedWidth;
  if (drag.to < drag.from && index >= drag.to && index < drag.from) return draggedWidth;
  return 0;
}

/** 把第 from 項搬到第 to 項的位置，其餘維持相對順序 */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
