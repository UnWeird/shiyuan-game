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
 * 获取从指定位置沿某方向的射击路径 (直到射程上限或被阻挡)
 * @param from 起始位置
 * @param direction 方向
 * @param maxRange 最大射程（格数）
 * @param blockedHexes 被占用的位置（可选，用于检测阻挡）
 * @returns 射击路径上的所有六边形坐标
 */
export function getShootingPath(
  from: HexCoord,
  direction: Direction,
  maxRange: number,
  blockedHexes?: HexCoord[]
): HexCoord[] {
  const path: HexCoord[] = [];
  let current = hexNeighbor(from, direction);
  let distance = 1; // 当前距离起点的步数

  while (distance <= maxRange) {
    // 检查是否还在地图范围内（地图半径固定为5）
    if (!isInMapRange(current, 5)) {
      break;
    }

    path.push(current);

    // 如果遇到阻挡，停止延伸
    if (blockedHexes && blockedHexes.some(hex => hexEquals(hex, current))) {
      break;
    }

    current = hexNeighbor(current, direction);
    distance++;
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
 * @param machineType 机关类型（弩车、战车或投石车）
 * @returns 所有占用的六边形坐标数组
 */
export function getMachineOccupiedHexes(
  position: HexCoord,
  machineType: 'ballista' | 'chariot' | 'catapult',
  isPlayerOne?: boolean
): HexCoord[] {
  const occupied: HexCoord[] = [position]; // 中心位置

  if (machineType === 'ballista') {
    // 弩车占用3格：倒V形，中心 + 左后、右后
    // 玩家1朝上（敌人在北），后方是南；玩家2朝下（敌人在南），后方是北
    if (isPlayerOne === true) {
      occupied.push(hexNeighbor(position, Direction.SOUTH_EAST)); // 右后
      occupied.push(hexNeighbor(position, Direction.SOUTH_WEST)); // 左后
    } else if (isPlayerOne === false) {
      occupied.push(hexNeighbor(position, Direction.NORTH_EAST)); // 右后
      occupied.push(hexNeighbor(position, Direction.NORTH_WEST)); // 左后
    } else {
      // 兼容旧调用（默认玩家1）
      occupied.push(hexNeighbor(position, Direction.SOUTH_EAST));
      occupied.push(hexNeighbor(position, Direction.SOUTH_WEST));
    }
  } else if (machineType === 'chariot') {
    // 战车占用4格：中心 + 右上、右、右下
    occupied.push(hexNeighbor(position, Direction.NORTH_EAST)); // 右上
    occupied.push(hexNeighbor(position, Direction.EAST));       // 右
    occupied.push(hexNeighbor(position, Direction.SOUTH_EAST)); // 右下
  } else if (machineType === 'catapult') {
    // 投石车占用3格：V形，中心 + 左前、右前
    // 玩家1朝上（敌人在北），前方是北；玩家2朝下（敌人在南），前方是南
    if (isPlayerOne === true) {
      occupied.push(hexNeighbor(position, Direction.NORTH_WEST)); // 左前
      occupied.push(hexNeighbor(position, Direction.NORTH_EAST)); // 右前
    } else if (isPlayerOne === false) {
      occupied.push(hexNeighbor(position, Direction.SOUTH_WEST)); // 左前
      occupied.push(hexNeighbor(position, Direction.SOUTH_EAST)); // 右前
    } else {
      // 兼容旧调用（默认玩家1）
      occupied.push(hexNeighbor(position, Direction.NORTH_WEST));
      occupied.push(hexNeighbor(position, Direction.NORTH_EAST));
    }
  }

  return occupied;
}

/**
 * 计算从source到target的方向向量，返回沿哪个轴移动
 * @param source 攻击来源位置
 * @param target 目标位置
 * @returns 返回 'q' | 'r' | 's' 表示沿哪个轴，以及方向（1或-1）
 */
export function getAxisDirection(source: HexCoord, target: HexCoord): { axis: 'q' | 'r' | 's', direction: number } | null {
  const dq = target.q - source.q;
  const dr = target.r - source.r;
  const ds = target.s - source.s;

  // 判断在哪个轴上移动（有一个坐标不变）
  if (dq === 0) {
    // 沿r轴（q不变）
    return { axis: 'q', direction: dr > 0 ? 1 : -1 };
  } else if (dr === 0) {
    // 沿q轴（r不变）
    return { axis: 'r', direction: dq > 0 ? 1 : -1 };
  } else if (ds === 0) {
    // 沿s轴（s不变）
    return { axis: 's', direction: dq > 0 ? 1 : -1 };
  }

  // 不在同一轴上
  return null;
}

/**
 * 沿指定轴线向远离source的方向延伸，查找该轴线上的所有格子
 * @param target 目标格子
 * @param source 攻击来源格子
 * @param mapRadius 地图半径
 * @returns 轴线上从target向远离source方向的所有格子（不含target自身）
 */
export function getAxisLineFromTarget(target: HexCoord, source: HexCoord, mapRadius: number): HexCoord[] {
  const result: HexCoord[] = [];
  const axisDir = getAxisDirection(source, target);

  if (!axisDir) {
    // 不在同一轴上，返回空数组
    return result;
  }

  let current = { ...target };

  // 沿该轴向远离source的方向延伸
  while (true) {
    // 计算下一个格子
    if (axisDir.axis === 'q') {
      // q不变，r和s移动
      current = createHex(current.q, current.r + axisDir.direction);
    } else if (axisDir.axis === 'r') {
      // r不变，q和s移动
      current = createHex(current.q + axisDir.direction, current.r);
    } else {
      // s不变，q和r移动
      current = createHex(current.q + axisDir.direction, current.r - axisDir.direction);
    }

    // 检查是否还在地图范围内
    if (!isInMapRange(current, mapRadius)) {
      break;
    }

    // 检查是否远离source（距离增加）
    if (hexDistance(current, source) <= hexDistance(target, source)) {
      break;
    }

    result.push(current);
  }

  return result;
}

/**
 * 计算到起始区域边线的距离
 * @param position 当前位置
 * @param playerSide 玩家方向（'top' 或 'bottom'）
 * @returns 到边线的六边形距离
 */
export function getDistanceToBaseline(position: HexCoord, playerSide: 'top' | 'bottom'): number {
  if (playerSide === 'top') {
    // 玩家1的起始区边线在r=3，返回|r-3|但确保非负
    return Math.max(0, 5 - position.r); // r=5是最后排，r=3是边线，所以距离是5-r
  } else {
    // 玩家2的起始区边线在r=-3
    return Math.max(0, 5 + position.r); // r=-5是最后排，r=-3是边线，所以距离是5+r
  }
}

/**
 * 尝试将单位向指定方向击退一格
 * @param position 单位当前位置
 * @param awayFromSource 远离的来源位置
 * @param mapRadius 地图半径
 * @param isPositionBlocked 检查位置是否被占用的函数
 * @returns 击退后的位置，如果无法击退则返回null
 */
export function tryKnockback(
  position: HexCoord,
  awayFromSource: HexCoord,
  mapRadius: number,
  isPositionBlocked: (pos: HexCoord) => boolean
): HexCoord | null {
  const axisDir = getAxisDirection(awayFromSource, position);
  if (!axisDir) {
    return null; // 不在轴线上，无法击退
  }

  // 计算击退后的位置
  let knockbackPos: HexCoord;
  if (axisDir.axis === 'q') {
    // q不变，r和s移动
    knockbackPos = createHex(position.q, position.r + axisDir.direction);
  } else if (axisDir.axis === 'r') {
    // r不变，q和s移动
    knockbackPos = createHex(position.q + axisDir.direction, position.r);
  } else {
    // s不变，q和r移动
    knockbackPos = createHex(position.q + axisDir.direction, position.r - axisDir.direction);
  }

  // 检查击退位置是否有效
  if (!isInMapRange(knockbackPos, mapRadius)) {
    return null; // 越界
  }

  if (isPositionBlocked(knockbackPos)) {
    return null; // 被占用
  }

  return knockbackPos;
}

/**
 * 步兵击退传导机制
 * @param startPosition 第一个被击退的步兵位置
 * @param awayFromSource 远离的攻击来源位置
 * @param mapRadius 地图半径
 * @param getUnitAtPosition 获取指定位置的单位（返回单位类型和ID）
 * @param isPositionOccupied 检查位置是否被占用
 * @returns 击退结果数组，每项包含单位ID、新位置（成功击退）或伤害（被阻挡）
 */
export function knockbackInfantryChain(
  startPosition: HexCoord,
  awayFromSource: HexCoord,
  mapRadius: number,
  getUnitAtPosition: (pos: HexCoord) => { type: string; id: string; owner: string } | null,
  isPositionOccupied: (pos: HexCoord, excludeIds: string[]) => boolean
): Array<{ id: string; newPosition?: HexCoord; takeDamage?: boolean }> {
  const results: Array<{ id: string; newPosition?: HexCoord; takeDamage?: boolean }> = [];
  const processedIds = new Set<string>(); // 防止重复处理

  // 获取击退方向
  const axisDir = getAxisDirection(awayFromSource, startPosition);
  if (!axisDir) {
    return results; // 不在轴线上，无法击退
  }

  let currentPos = startPosition;

  // 沿击退方向查找连续的步兵
  while (true) {
    const currentUnit = getUnitAtPosition(currentPos);

    // 检查当前位置是否有步兵
    if (!currentUnit || currentUnit.type !== 'infantry') {
      // 遇到非步兵或空格子，停止传导
      break;
    }

    // 防止重复处理
    if (processedIds.has(currentUnit.id)) {
      break;
    }
    processedIds.add(currentUnit.id);

    // 计算击退目标位置
    let knockbackPos: HexCoord;
    if (axisDir.axis === 'q') {
      knockbackPos = createHex(currentPos.q, currentPos.r + axisDir.direction);
    } else if (axisDir.axis === 'r') {
      knockbackPos = createHex(currentPos.q + axisDir.direction, currentPos.r);
    } else {
      knockbackPos = createHex(currentPos.q + axisDir.direction, currentPos.r - axisDir.direction);
    }

    // 检查击退目标位置
    const isOutOfBounds = !isInMapRange(knockbackPos, mapRadius);
    const isBlocked = isPositionOccupied(knockbackPos, Array.from(processedIds));

    if (isOutOfBounds || isBlocked) {
      // 遇到边界或被阻挡
      const blockingUnit = getUnitAtPosition(knockbackPos);

      // 如果被阻挡是因为有非步兵单位，则停止传导并给当前步兵扣血
      if (blockingUnit && blockingUnit.type !== 'infantry') {
        results.push({ id: currentUnit.id, takeDamage: true });
        break;
      }

      // 如果是地图边界或空格子阻挡，也扣血并停止
      if (isOutOfBounds || !blockingUnit) {
        results.push({ id: currentUnit.id, takeDamage: true });
        break;
      }

      // 如果被阻挡是因为另一个已处理的步兵，扣血并停止
      if (blockingUnit && processedIds.has(blockingUnit.id)) {
        results.push({ id: currentUnit.id, takeDamage: true });
        break;
      }
    }

    // 可以击退，记录结果
    results.push({ id: currentUnit.id, newPosition: knockbackPos });

    // 继续检查下一个位置
    currentPos = knockbackPos;
  }

  return results;
}

/**
 * 获取投石车攻击的溅射目标格子
 * @param attackerPos 攻击者位置
 * @param targetPos 主要目标位置
 * @param chargeLevel 蓄力层数（0=无蓄力, 1=一层蓄力, 2=两层蓄力）
 * @param mapRadius 地图半径
 * @returns 溅射目标格子数组
 */
export function getCatapultSplashTargets(
  attackerPos: HexCoord,
  targetPos: HexCoord,
  chargeLevel: number,
  mapRadius: number
): HexCoord[] {
  const splashTargets: HexCoord[] = [];

  if (chargeLevel === 0) {
    // 无蓄力，无溅射
    return splashTargets;
  }

  // 计算击退方向（从攻击者指向目标）
  const dq = targetPos.q - attackerPos.q;
  const dr = targetPos.r - attackerPos.r;
  const ds = targetPos.s - attackerPos.s;

  // 找到主要移动方向（六边形的6个方向之一）
  let knockbackDirection: Direction | null = null;
  const neighbors = hexNeighbors(attackerPos);

  // 找到从攻击者到目标路径上的第一个相邻格子
  const pathToTarget = hexLineDraw(attackerPos, targetPos);
  if (pathToTarget.length >= 2) {
    const firstStep = pathToTarget[1]; // 第一步（攻击者的下一个格子）

    // 找到对应的方向
    for (let dir = 0; dir < 6; dir++) {
      if (hexEquals(neighbors[dir], firstStep)) {
        knockbackDirection = dir as Direction;
        break;
      }
    }
  }

  // 如果找不到明确方向，尝试根据坐标差值估算
  if (knockbackDirection === null) {
    const absQ = Math.abs(dq);
    const absR = Math.abs(dr);
    const absS = Math.abs(ds);

    // 找出最大的坐标差值，确定主要方向
    if (dq > 0 && absQ >= absR && absQ >= absS) {
      knockbackDirection = dr < 0 ? Direction.NORTH_EAST : Direction.EAST;
    } else if (dq < 0 && absQ >= absR && absQ >= absS) {
      knockbackDirection = dr > 0 ? Direction.SOUTH_WEST : Direction.WEST;
    } else if (dr < 0 && absR >= absQ && absR >= absS) {
      knockbackDirection = dq > 0 ? Direction.NORTH_EAST : Direction.NORTH_WEST;
    } else if (dr > 0 && absR >= absQ && absR >= absS) {
      knockbackDirection = dq < 0 ? Direction.SOUTH_WEST : Direction.SOUTH_EAST;
    } else {
      // 默认使用东方向
      knockbackDirection = Direction.EAST;
    }
  }

  // 计算目标背后的格子
  const behindTarget = hexNeighbor(targetPos, knockbackDirection);

  if (chargeLevel === 1) {
    // 一层蓄力：溅射目标背后的1个格子
    if (isInMapRange(behindTarget, mapRadius)) {
      splashTargets.push(behindTarget);
    }
  } else if (chargeLevel >= 2) {
    // 两层蓄力：溅射目标背后120°扇形的3个格子
    // 中心方向 + 左右各60°
    const centerDir = knockbackDirection;
    const leftDir = ((knockbackDirection + 5) % 6) as Direction; // 逆时针60度
    const rightDir = ((knockbackDirection + 1) % 6) as Direction; // 顺时针60度

    // 获取3个方向上目标背后的格子
    const centerSplash = hexNeighbor(targetPos, centerDir);
    const leftSplash = hexNeighbor(targetPos, leftDir);
    const rightSplash = hexNeighbor(targetPos, rightDir);

    // 添加在地图范围内的格子
    if (isInMapRange(centerSplash, mapRadius)) {
      splashTargets.push(centerSplash);
    }
    if (isInMapRange(leftSplash, mapRadius)) {
      splashTargets.push(leftSplash);
    }
    if (isInMapRange(rightSplash, mapRadius)) {
      splashTargets.push(rightSplash);
    }
  }

  return splashTargets;
}
