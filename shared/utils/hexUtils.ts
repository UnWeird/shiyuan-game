import { HexCoord, Direction } from '../types';

/**
 * 创建六边形坐标
 */
export function createHex(q: number, r: number): HexCoord {
  return { q, r, s: -q - r };
}

/**
 * 检查六边形坐标是否有效
 */
export function isValidHex(hex: HexCoord): boolean {
  return Math.abs(hex.q + hex.r + hex.s) < 0.0001; // 浮点数精度
}

/**
 * 比较两个六边形坐标是否相等
 */
export function hexEquals(a: HexCoord, b: HexCoord): boolean {
  return a.q === b.q && a.r === b.r && a.s === b.s;
}

/**
 * 六边形方向向量 (flat-top 布局)
 * 对应六边形的6条边：东、东北、西北、西、西南、东南
 */
const HEX_DIRECTIONS: HexCoord[] = [
  createHex(1, 0),   // EAST (东)
  createHex(1, -1),  // NORTH_EAST (东北)
  createHex(0, -1),  // NORTH_WEST (西北)
  createHex(-1, 0),  // WEST (西)
  createHex(-1, 1),  // SOUTH_WEST (西南)
  createHex(0, 1),   // SOUTH_EAST (东南)
];

/**
 * 获取指定方向的邻居坐标
 */
export function hexNeighbor(hex: HexCoord, direction: Direction): HexCoord {
  const dir = HEX_DIRECTIONS[direction];
  return createHex(hex.q + dir.q, hex.r + dir.r);
}

/**
 * 获取所有邻居坐标
 */
export function hexNeighbors(hex: HexCoord): HexCoord[] {
  return HEX_DIRECTIONS.map(dir =>
    createHex(hex.q + dir.q, hex.r + dir.r)
  );
}

/**
 * 计算两个六边形之间的距离
 */
export function hexDistance(a: HexCoord, b: HexCoord): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.s - b.s)) / 2;
}

/**
 * 生成六边形地图 (边长为radius的六边形)
 */
export function generateHexMap(radius: number): HexCoord[] {
  const hexes: HexCoord[] = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) {
      hexes.push(createHex(q, r));
    }
  }
  return hexes;
}

/**
 * 判断六边形是否在地图范围内
 */
export function isInMapRange(hex: HexCoord, radius: number): boolean {
  return Math.abs(hex.q) <= radius &&
         Math.abs(hex.r) <= radius &&
         Math.abs(hex.s) <= radius;
}

/**
 * 判断六边形是否在玩家的起始区 (从玩家视角看的前三排)
 * 地图半径为6，但坐标从0开始，所以r范围是-5到+5
 * @param hex 六边形坐标
 * @param playerSide 'top' 或 'bottom'
 */
export function isInStartZone(hex: HexCoord, playerSide: 'top' | 'bottom'): boolean {
  if (playerSide === 'top') {
    // 玩家1的起始区: r >= 3，实际是r=3,4,5三排
    return hex.r >= 3;
  } else {
    // 玩家2的起始区: r <= -3，实际是r=-3,-4,-5三排
    return hex.r <= -3;
  }
}

/**
 * 判断六边形是否在交战区
 */
export function isInBattleZone(hex: HexCoord): boolean {
  return hex.r > -3 && hex.r < 3;
}

/**
 * 计算从a到b的直线路径 (用于弓箭手射击判定)
 */
export function hexLineDraw(a: HexCoord, b: HexCoord): HexCoord[] {
  const N = hexDistance(a, b);
  if (N === 0) return [a];

  const results: HexCoord[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const q = a.q * (1 - t) + b.q * t;
    const r = a.r * (1 - t) + b.r * t;
    const s = a.s * (1 - t) + b.s * t;
    results.push(hexRound({ q, r, s }));
  }
  return results;
}

/**
 * 六边形坐标取整
 */
export function hexRound(hex: HexCoord): HexCoord {
  let q = Math.round(hex.q);
  let r = Math.round(hex.r);
  let s = Math.round(hex.s);

  const qDiff = Math.abs(q - hex.q);
  const rDiff = Math.abs(r - hex.r);
  const sDiff = Math.abs(s - hex.s);

  if (qDiff > rDiff && qDiff > sDiff) {
    q = -r - s;
  } else if (rDiff > sDiff) {
    r = -q - s;
  } else {
    s = -q - r;
  }

  return { q, r, s };
}

/**
 * 获取范围内的所有六边形 (用于范围攻击)
 */
export function hexRange(center: HexCoord, range: number): HexCoord[] {
  const results: HexCoord[] = [];
  for (let q = -range; q <= range; q++) {
    const r1 = Math.max(-range, -q - range);
    const r2 = Math.min(range, -q + range);
    for (let r = r1; r <= r2; r++) {
      results.push(createHex(center.q + q, center.r + r));
    }
  }
  return results;
}

/**
 * 判断目标是否在指定方向的直线上 (弓箭手朝向判定)
 */
export function isInDirection(from: HexCoord, to: HexCoord, direction: Direction): boolean {
  if (hexEquals(from, to)) return false;

  const path = hexLineDraw(from, to);
  if (path.length < 2) return false;

  // 检查第二个点是否在指定方向上
  const nextHex = hexNeighbor(from, direction);
  return hexEquals(path[1], nextHex);
}

/**
 * 获取从指定位置沿某方向的射击路径 (直到地图边界或被阻挡)
 * @param from 起始位置
 * @param direction 方向
 * @param mapRadius 地图半径
 * @param blockedHexes 被占用的位置（可选，用于检测阻挡）
 * @returns 射击路径上的所有六边形坐标
 */
export function getShootingPath(
  from: HexCoord,
  direction: Direction,
  mapRadius: number,
  blockedHexes?: HexCoord[]
): HexCoord[] {
  const path: HexCoord[] = [];
  let current = hexNeighbor(from, direction);

  while (isInMapRange(current, mapRadius)) {
    path.push(current);

    // 如果遇到阻挡，停止延伸
    if (blockedHexes && blockedHexes.some(hex => hexEquals(hex, current))) {
      break;
    }

    current = hexNeighbor(current, direction);
  }

  return path;
}

/**
 * 获取弩车的垂直贯穿路径（正前方）
 * 玩家1正前方：每格 (q+1, r-2, s+1)
 * 玩家2正前方：每格 (q-1, r+2, s-1)
 * @param from 起始位置（弩车位置）
 * @param isPlayerOne 是否为玩家1（玩家1朝北攻击，玩家2朝南攻击）
 * @param mapRadius 地图半径
 * @returns 垂直贯穿路径
 */
export function getBallistaVerticalPath(
  from: HexCoord,
  isPlayerOne: boolean,
  mapRadius: number
): HexCoord[] {
  const path: HexCoord[] = [];

  // 正前方推进的增量
  // 玩家1: (q+1, r-2, s+1)
  // 玩家2: (q-1, r+2, s-1)
  const dq = isPlayerOne ? 1 : -1;
  const dr = isPlayerOne ? -2 : 2;
  const ds = isPlayerOne ? 1 : -1;

  let current = from;

  while (true) {
    // 计算下一个正前方位置
    const nextQ = current.q + dq;
    const nextR = current.r + dr;
    const nextS = current.s + ds;

    current = { q: nextQ, r: nextR, s: nextS };

    if (!isInMapRange(current, mapRadius)) {
      break;
    }

    path.push(current);
  }

  return path;
}

/**
 * 获取扇形区域内的所有六边形（无双将军技能用）
 * 120度扇形：包括中心方向和左右各60度的相邻3个格子
 * @param from 起始位置（将领位置）
 * @param direction 中心方向
 * @param range 扇形范围（距离，但当前实现固定为相邻的3格）
 * @param mapRadius 地图半径
 * @returns 扇形区域内的所有六边形坐标
 */
export function getFanShapedHexes(
  from: HexCoord,
  direction: Direction,
  range: number,
  mapRadius: number
): HexCoord[] {
  const result: HexCoord[] = [];

  // 120度扇形：中心方向、左侧60度（逆时针一个方向）、右侧60度（顺时针一个方向）
  const centerDir = direction;
  const leftDir = ((direction + 5) % 6) as Direction; // 逆时针一个方向（60度）
  const rightDir = ((direction + 1) % 6) as Direction; // 顺时针一个方向（60度）

  // 获取相邻的3个格子
  const centerHex = hexNeighbor(from, centerDir);
  const leftHex = hexNeighbor(from, leftDir);
  const rightHex = hexNeighbor(from, rightDir);

  // 检查并添加到结果中
  if (isInMapRange(centerHex, mapRadius)) {
    result.push(centerHex);
  }
  if (isInMapRange(leftHex, mapRadius)) {
    result.push(leftHex);
  }
  if (isInMapRange(rightHex, mapRadius)) {
    result.push(rightHex);
  }

  return result;
}

/**
 * 将六边形坐标转换为像素坐标 (用于渲染)
 * @param hex 六边形坐标
 * @param size 六边形大小
 * @returns {x, y} 像素坐标
 */
export function hexToPixel(hex: HexCoord, size: number): { x: number; y: number } {
  const x = size * (Math.sqrt(3) * hex.q + Math.sqrt(3) / 2 * hex.r);
  const y = size * (3 / 2 * hex.r);
  return { x, y };
}

/**
 * 将像素坐标转换为六边形坐标 (用于点击检测)
 */
export function pixelToHex(x: number, y: number, size: number): HexCoord {
  const q = (Math.sqrt(3) / 3 * x - 1 / 3 * y) / size;
  const r = (2 / 3 * y) / size;
  return hexRound({ q, r, s: -q - r });
}

/**
 * 获取六边形的六个顶点坐标 (用于绘制)
 */
export function hexCorners(center: { x: number; y: number }, size: number): { x: number; y: number }[] {
  const corners: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i + 30);
    corners.push({
      x: center.x + size * Math.cos(angle),
      y: center.y + size * Math.sin(angle),
    });
  }
  return corners;
}

/**
 * 生成六边形的SVG路径
 */
export function hexToSVGPath(hex: HexCoord, size: number): string {
  const center = hexToPixel(hex, size);
  const corners = hexCorners(center, size);
  return corners.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x},${c.y}`).join(' ') + ' Z';
}

/**
 * 获取机关单位占用的所有格子
 * @param position 机关单位的中心位置
 * @param machineType 机关类型（弩车或战车）
 * @returns 所有占用的六边形坐标数组
 */
export function getMachineOccupiedHexes(
  position: HexCoord,
  machineType: 'ballista' | 'chariot'
): HexCoord[] {
  const occupied: HexCoord[] = [position]; // 中心位置

  if (machineType === 'ballista') {
    // 弩车占用5格：中心 + 右上、右下、左上、左下（4个对角）
    occupied.push(hexNeighbor(position, Direction.NORTH_EAST)); // 右上
    occupied.push(hexNeighbor(position, Direction.SOUTH_EAST)); // 右下
    occupied.push(hexNeighbor(position, Direction.NORTH_WEST)); // 左上
    occupied.push(hexNeighbor(position, Direction.SOUTH_WEST)); // 左下
  } else if (machineType === 'chariot') {
    // 战车占用4格：中心 + 右上、右、右下
    occupied.push(hexNeighbor(position, Direction.NORTH_EAST)); // 右上
    occupied.push(hexNeighbor(position, Direction.EAST));       // 右
    occupied.push(hexNeighbor(position, Direction.SOUTH_EAST)); // 右下
  }

  return occupied;
}
