import { moveItem, offsetOf, shiftFor, slotOf, targetFor } from '../reorder';

/**
 * 拖曳換位的算術。
 *
 * 寬度刻意取不一樣的值——等寬的話很多算錯的寫法也會剛好答對，
 * 測不出東西。這裡用 60 / 100 / 40，間距 10。
 */

const W = [60, 100, 40];
const GAP = 10;
// 左緣：0 / 70 / 180；中心：30 / 120 / 200

describe('拖曳換位的算術', () => {
  it('原本排列下每顆的左緣', () => {
    expect(offsetOf(W, GAP, 0)).toBe(0);
    expect(offsetOf(W, GAP, 1)).toBe(70);
    expect(offsetOf(W, GAP, 2)).toBe(180);
  });

  it('沒動就還是原來那格', () => {
    expect(targetFor(W, GAP, 0, 0)).toBe(0);
    expect(targetFor(W, GAP, 1, 0)).toBe(1);
    expect(targetFor(W, GAP, 2, 0)).toBe(2);
  });

  it('中心越過鄰居的中心才換位，差一點都不算', () => {
    // 第 0 顆中心在 30，第 1 顆中心在 120 => dx 要大於 90 才排到它後面
    expect(targetFor(W, GAP, 0, 89)).toBe(0);
    expect(targetFor(W, GAP, 0, 91)).toBe(1);
    // 反方向：第 2 顆中心在 200，第 1 顆中心在 120 => dx 要小於 -80
    expect(targetFor(W, GAP, 2, -79)).toBe(2);
    expect(targetFor(W, GAP, 2, -81)).toBe(1);
  });

  it('往右拖到底、往左拖到底', () => {
    expect(targetFor(W, GAP, 0, 500)).toBe(2);
    expect(targetFor(W, GAP, 2, -500)).toBe(0);
  });

  it('放手後停的位置，就是新排列裡它真正的左緣', () => {
    // 第 0 顆搬到最後：前面剩下 100 和 40 => 左緣 110+... 實際是 100+10+40+10 = 160
    expect(slotOf(W, GAP, 0, 2)).toBe(160);
    // 第 2 顆搬到最前面：前面沒有人
    expect(slotOf(W, GAP, 2, 0)).toBe(0);
    // 沒換位時停回原處
    expect(slotOf(W, GAP, 1, 1)).toBe(70);
  });

  it('讓位方向：往右拖時中間的往左讓，往左拖時往右讓', () => {
    const dragged = W[0] + GAP;
    expect(shiftFor(0, { from: 0, to: 2 }, dragged)).toBe(0); // 被拖的那顆自己不算
    expect(shiftFor(1, { from: 0, to: 2 }, dragged)).toBe(-dragged);
    expect(shiftFor(2, { from: 0, to: 2 }, dragged)).toBe(-dragged);

    const back = W[2] + GAP;
    expect(shiftFor(0, { from: 2, to: 0 }, back)).toBe(back);
    expect(shiftFor(1, { from: 2, to: 0 }, back)).toBe(back);
    expect(shiftFor(2, { from: 2, to: 0 }, back)).toBe(0);
  });

  it('沒有拖曳中就沒有人要讓位', () => {
    expect(shiftFor(1, null, 70)).toBe(0);
  });

  it('搬完之後的順序', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
  });

  /**
   * 兩者必須一致：畫面上「大家讓位後留下的空格」就是被拖那顆該停的地方。
   * 對不上的話，放手瞬間就會看到它跳一下。
   */
  it('讓位留下的空格，剛好等於放手要停的位置', () => {
    for (let from = 0; from < W.length; from += 1) {
      for (let to = 0; to < W.length; to += 1) {
        const draggedWidth = W[from] + GAP;
        // 空格左緣 = 原本各顆左緣 + 它們的讓位量，取排在 to 之前的那些之後
        let gapLeft = 0;
        for (let k = 0; k < W.length; k += 1) {
          if (k === from) continue;
          const shifted = offsetOf(W, GAP, k) + shiftFor(k, { from, to }, draggedWidth);
          if (shifted < slotOf(W, GAP, from, to)) gapLeft = shifted + W[k] + GAP;
        }
        const expected = slotOf(W, GAP, from, to);
        expect(gapLeft).toBe(to === 0 ? 0 : expected);
      }
    }
  });
});
