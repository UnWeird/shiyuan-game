import { describe, it, expect } from 'vitest';
import { seamPath, hexPath, boardViewBox } from '../utils/boardGeometry';
import { generateHexMap } from '../utils/hexUtils';
import { BOARD_ASPECT } from '../theme/boardTheme';

/** 半径 R 的六边形图的格子数 */
const hexCount = (R: number) => 3 * R * R + 3 * R + 1;
/** 相邻格对数（= 内部共享边数） */
const adjacentPairs = (R: number) => 9 * R * R + 3 * R;
/** 唯一边数 = 6N − 共享边数 */
const uniqueEdges = (R: number) => 6 * hexCount(R) - adjacentPairs(R);

const segmentsOf = (d: string) => (d.match(/M /g) ?? []).length;

describe('seamPath — 每条边只画一次', () => {
  /**
   * 这是回归测试，守的是一个具体的坑：
   * 去重键若用像素坐标，√3 带来的小数会让相邻格算出的同一顶点落在
   * 26.649999 / 26.650001 两侧，字符串键不相等，共享边就被画两遍。
   * 实测半径 5 时会多出 14 条（320 条 vs 应有 306 条），表现为局部缝线偏粗。
   */
  it.each([1, 2, 3, 4, 5, 6])('半径 %i 的边数与理论值相符', (R) => {
    expect(segmentsOf(seamPath(R, 31))).toBe(uniqueEdges(R));
  });

  it('半径 5 恰好 306 条（棋盘实际用的半径）', () => {
    expect(segmentsOf(seamPath(5, 40))).toBe(306);
    expect(hexCount(5)).toBe(generateHexMap(5).length);
  });

  it('边数与格子尺寸无关', () => {
    expect(segmentsOf(seamPath(5, 12))).toBe(segmentsOf(seamPath(5, 97.3)));
  });

  it('没有零长度的边', () => {
    const segs = seamPath(3, 40).split('M ').filter(Boolean);
    for (const s of segs) {
      const [a, b] = s.trim().split(' L ');
      expect(a).not.toBe(b);
    }
  });
});

describe('hexPath', () => {
  it('是一条闭合路径，六个顶点', () => {
    const d = hexPath({ q: 0, r: 0, s: 0 }, 40);
    expect(d.endsWith(' Z')).toBe(true);
    expect((d.match(/[ML] /g) ?? []).length).toBe(6);
  });

  it('k 缩放只影响到中心的距离，不改变顶点数', () => {
    const outer = hexPath({ q: 1, r: -1, s: 0 }, 40, 1);
    const inner = hexPath({ q: 1, r: -1, s: 0 }, 40, 0.5);
    expect((inner.match(/[ML] /g) ?? []).length).toBe(6);
    expect(inner).not.toBe(outer);
  });
});

describe('boardViewBox', () => {
  it('长宽比与 BOARD_ASPECT 一致 —— 布局用它算棋盘容器尺寸，两边必须同源', () => {
    const vb = boardViewBox(5, 40);
    expect(vb.width / vb.height).toBeCloseTo(BOARD_ASPECT, 6);
  });

  it('以原点为中心', () => {
    const vb = boardViewBox(5, 40);
    expect(vb.minX + vb.width / 2).toBeCloseTo(0, 6);
    expect(vb.minY + vb.height / 2).toBeCloseTo(0, 6);
  });
});
