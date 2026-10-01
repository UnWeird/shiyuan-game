/**
 * 棋盘绘制几何：只服务渲染，不含任何游戏规则。
 *
 * 规格：docs/board-art-spec.md §4.2
 */

import type { HexCoord } from '../types';
import { hexToPixel, hexCorners, generateHexMap } from './hexUtils';

/** 单个六边形的 SVG path。k < 1 时画在内侧（用于内边线、内圈环） */
export function hexPath(hex: HexCoord, size: number, k = 1): string {
  const c = hexToPixel(hex, size);
  return (
    hexCorners(c, size)
      .map((p, i) => {
        const x = c.x + (p.x - c.x) * k;
        const y = c.y + (p.y - c.y) * k;
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ') + ' Z'
  );
}

/**
 * hexCorners 的顶点角是 60i+30，所以边 i（顶点 i → i+1）的外法线朝向 60(i+1)°。
 * 据此得出每条边对应的邻居偏移 —— 用它把"边"映射到"格对"。
 */
const EDGE_NEIGHBOR: ReadonlyArray<readonly [number, number]> = [
  [0, 1],   // 边 0 法线  60° → SE
  [-1, 1],  // 边 1 法线 120° → SW
  [-1, 0],  // 边 2 法线 180° → W
  [0, -1],  // 边 3 法线 240° → NW
  [1, -1],  // 边 4 法线 300° → NE
  [1, 0],   // 边 5 法线   0° → E
];

/**
 * 整张棋盘的缝线，每条边只画一次，输出单个 path。
 *
 * 去重键必须用**整数格坐标对**，不能用像素坐标：像素坐标含 √3 无理因子，
 * 两个相邻格算同一个顶点时会落在 26.649999 / 26.650001 这类小数边界两侧，
 * 取小数位做字符串键会得到两个不同的键，那条共享边就被画了两遍。
 * 实测半径 5 时会漏掉 14 条（留下 320 条，应为 306 条），表现为局部缝线偏粗 ——
 * 这正是旧实现里逐格描边导致"格子边缘发脏"的同一类问题。
 *
 * 边数满足 6N − (9R² + 3R)，N = 3R²+3R+1。已验证 R=1→30 / 2→72 / 3→132 / 5→306。
 */
export function seamPath(radius: number, size: number): string {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const hex of generateHexMap(radius)) {
    const corners = hexCorners(hexToPixel(hex, size), size);
    for (let i = 0; i < 6; i++) {
      const [dq, dr] = EDGE_NEIGHBOR[i];
      const me = `${hex.q},${hex.r}`;
      const nb = `${hex.q + dq},${hex.r + dr}`;
      const key = me < nb ? `${me}|${nb}` : `${nb}|${me}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const a = corners[i];
      const b = corners[(i + 1) % 6];
      out.push(
        `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} L ${b.x.toFixed(2)} ${b.y.toFixed(2)}`
      );
    }
  }
  return out.join(' ');
}

/** 棋盘 SVG 的 viewBox：四周留出一格的漆盘边 */
export function boardViewBox(radius: number, size: number) {
  const maxX = size * Math.sqrt(3) * radius;
  const maxY = size * 1.5 * radius;
  const pad = size;
  return {
    minX: -maxX - pad,
    minY: -maxY - pad,
    width: (maxX + pad) * 2,
    height: (maxY + pad) * 2,
  };
}
