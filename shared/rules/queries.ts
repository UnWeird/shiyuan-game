import { Direction } from '../types';
import type { HexCoord } from '../types';
import {
  getAxisLineFromTarget,
  getDistanceToBaseline,
  getMachineOccupiedHexes,
  getShootingPath,
  hexDistance,
  hexEquals,
  hexLineDraw,
  hexNeighbor,
  hexNeighbors,
  hexRange,
  isInMapRange,
} from '../utils/hexUtils';

/**
 * 规则查询层 —— 全项目唯一的「这步能不能走 / 这个目标能不能打」实现
 *
 * 为什么抽到 shared/：这些判定原来是 ShiyuanRoom 的私有方法，只有服务端能用。
 * 客户端要画高亮就得自己再实现一遍，两份实现会漂移 ——
 * 典型症状是界面高亮了一个格子、点下去却被服务端拒绝。
 *
 * 这一层是**纯查询**：只读状态、不改状态、不发消息、不写战报。
 * 唯一的外部依赖就是「当前场上有哪些单位」，所以参数只需要一个单位数组，
 * 不需要把整个 GameState 抽象出来。
 *
 * 结算逻辑（移动/攻击的实际效果、击退连锁、击杀、掷骰）仍在 ShiyuanRoom 里，
 * 那部分和 Colyseus Schema、client.send 深度耦合，是另一次重构。
 */

/** 地图半径。半径 5 的六边形共 91 格。 */
export const MAP_RADIUS = 5;

/**
 * 移动落点的后果标记（服务端在 validActions.moves 的第 4 个元素里下发）。
 *
 * 位掩码而不是枚举，因为后果可以叠加。目前只有骑兵会带标记：
 * handleMove 只对 cavalry 记 moveDistance，handleAttack 的冲锋加成也只判 cavalry。
 *
 * 放在这里而不是各端自己定义，是为了让「客户端画的色带」和「服务端算的后果」
 * 共用同一组常量 —— 这两个数字一旦分叉，玩家看到的高亮就会和实际结算不符。
 */
export const MOVE_FLAG_DAMAGE_UP = 1;
/** 本回合不能攻击（骑兵冲满 3 格） */
export const MOVE_FLAG_NO_ATTACK = 2;

/**
 * 规则判定需要的最小单位形状。
 *
 * 刻意不复用服务端的 UnitSchema 或客户端的 Unit：
 * 前者带 Colyseus 装饰器，后者用嵌套的 position。
 * 两边各自做一次浅映射即可（见 toUnitLike）。
 */
export interface UnitLike {
  id: string;
  type: string;
  owner: string;
  q: number;
  r: number;
  s: number;
  /** 当前体力。伤害预测要用它判断这一下是否致命 */
  hp: number;
  /** 骑兵本回合移动了几格（只有骑兵会被记录），影响冲锋伤害加成 */
  moveDistance: number;
  direction: number;
  actionsThisTurn: number;
  hasMoved: boolean;
  hasAttacked: boolean;
  hasActedThisTurn: boolean;
  generalType: string;
  bonusActionLimit: number;
  unlimitedActions: boolean;
  movementRestricted: boolean;
  movementRestrictionSourceQ: number;
  movementRestrictionSourceR: number;
  movementRestrictionSourceS: number;
}

/** 单位占据的格子：机关占多格，其余就是自己那一格 */
export function occupiedHexesOf(unit: UnitLike): HexCoord[] {
  const pos = { q: unit.q, r: unit.r, s: unit.s };
  if (unit.type === 'ballista' || unit.type === 'chariot' || unit.type === 'catapult') {
    return getMachineOccupiedHexes(
      pos,
      unit.type as 'ballista' | 'chariot' | 'catapult',
      unit.owner === 'player1'
    );
  }
  return [pos];
}

/**
 * 检查一个格子是否被机关单位占据
 * 机关单位（弩车、战车）占据多个格子，任何一个格子都不能被其他单位通过或占用
 */
export function isHexOccupiedByMachine(hex: { q: number; r: number; s: number }, units: readonly UnitLike[]): boolean {
  // 遍历所有单位，检查是否有机关单位占据了这个格子
  for (const unit of units) {
    if (unit.type === 'ballista' || unit.type === 'chariot') {
      const machineType = unit.type === 'ballista' ? 'ballista' : 'chariot';
      const occupiedHexes = getMachineOccupiedHexes(
        { q: unit.q, r: unit.r, s: unit.s },
        machineType
      );

      // 检查这个hex是否在机关单位占据的格子中
      if (occupiedHexes.some(occupiedHex => hexEquals(occupiedHex, hex))) {
        return true;
      }
    }
  }
  return false;
}

/** 同 isHexOccupiedByMachine，但排除指定 id 的单位（用于战车崩毁时自身尚未删除的情况） */
export function isHexOccupiedByMachineExcluding(hex: { q: number; r: number; s: number }, excludeId: string, units: readonly UnitLike[]): boolean {
  for (const unit of units) {
    if (unit.id === excludeId) continue;
    if (unit.type === 'ballista' || unit.type === 'chariot') {
      const machineType = unit.type === 'ballista' ? 'ballista' : 'chariot';
      const occupiedHexes = getMachineOccupiedHexes(
        { q: unit.q, r: unit.r, s: unit.s },
        machineType
      );
      if (occupiedHexes.some(occupiedHex => hexEquals(occupiedHex, hex))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 计算弩车垂直贯穿路径
 */
export function getBallistaVerticalPath(ballista: UnitLike, isPlayerOne: boolean): Array<{ q: number, r: number, s: number }> {
  const path: Array<{ q: number, r: number, s: number }> = [];

  // 正前方推进的增量
  // 玩家1: (q+1, r-2, s+1)
  // 玩家2: (q-1, r+2, s-1)
  const dq = isPlayerOne ? 1 : -1;
  const dr = isPlayerOne ? -2 : 2;
  const ds = isPlayerOne ? 1 : -1;

  let current = { q: ballista.q, r: ballista.r, s: ballista.s };

  while (true) {
    // 计算下一个正前方位置
    const nextQ = current.q + dq;
    const nextR = current.r + dr;
    const nextS = current.s + ds;

    current = { q: nextQ, r: nextR, s: nextS };

    if (!isInMapRange(current, 5)) {
      break;
    }

    path.push(current);
  }

  return path;
}

/**
 * 机关的范围型攻击覆盖格（供客户端画高亮）。
 *
 * 弩车的垂直贯穿、投石车沿朝向的射击都不是「选一个目标」，而是覆盖一条线，
 * 所以不能用 getAttackableTargets 表达。以前这两条线由客户端自己算，
 * 现在和服务端校验用的是同一套计算。
 */
export function getAttackRangeHexes(unit: UnitLike): HexCoord[] {
  const pos = { q: unit.q, r: unit.r, s: unit.s };

  if (unit.type === 'ballista') {
    if (unit.hasActedThisTurn) return [];
    return getBallistaVerticalPath(unit, unit.owner === 'player1');
  }

  if (unit.type === 'catapult') {
    if (unit.actionsThisTurn >= 2) return [];
    return getShootingPath(pos, unit.direction, 5);
  }

  return [];
}

/**
 * 弩车近战攻击的合法性。
 *
 * 弩车不走 checkAttackLegality（它有专用的贯穿 / 近战指令），所以需要单独一份。
 * 原来 handleBallistaMeleeAttack 扣掉行动点后就直接 `target.hp -= 1`，
 * **完全没有相邻判定、也没判敌我** —— 等于弩车可以近战全图任何单位。
 * 范围规则此前只存在于客户端的高亮计算里。
 */
export function checkBallistaMeleeLegality(
ballista: UnitLike,
target: UnitLike,
units: readonly UnitLike[]
): { ok: true } | { ok: false; reason: string } {
  if (ballista.type !== 'ballista') return { ok: false, reason: "不是弩车" };
  if (ballista.hasActedThisTurn) return { ok: false, reason: "弩车本回合已行动" };
  if (target.owner === ballista.owner) return { ok: false, reason: "不能攻击友军" };

  const myHexes = occupiedHexesOf(ballista);
  const targetHexes = occupiedHexesOf(target);
  const adjacent = myHexes.some(a => targetHexes.some(t => hexDistance(a, t) === 1));
  if (!adjacent) return { ok: false, reason: "目标不在弩车近战范围内" };

  return { ok: true };
}

/**
 * 判断 attacker 能否攻击 target（不产生任何副作用）
 *
 * 从 handleAttackUnit 里抽出来的，目的是让「校验」和「算可攻击目标下发给客户端」
 * 用同一份判断。以前客户端自己实现了一份 getValidAttacks 来算高亮，
 * 服务端另有一份内联校验，两边算得不一样时玩家就会点到被拒绝的格子。
 *
 * 注意：这里不写战报、不改状态。弓箭手被友军阻挡只通过 archerBlocked 报告，
 * 由调用方决定要不要记日志。
 */
export function checkAttackLegality(
attacker: UnitLike,
target: UnitLike,
units: readonly UnitLike[]
): { ok: true; cost: number; archerBlocked: boolean } | { ok: false; reason: string } {
  // --- 行动次数限制 ---
  if (attacker.type === 'archer' && attacker.actionsThisTurn >= 2) {
    return { ok: false, reason: "该单位本回合已达行动次数上限" };
  }
  if (attacker.type !== 'archer' && attacker.hasAttacked) {
    return { ok: false, reason: "该单位本回合已攻击过" };
  }
  if (attacker.type === 'catapult' && attacker.actionsThisTurn >= 2) {
    return { ok: false, reason: "投石车本回合已达行动次数上限" };
  }

  // --- 攻击范围 ---
  const attackerPos = { q: attacker.q, r: attacker.r, s: attacker.s };
  const targetPos   = { q: target.q,   r: target.r,   s: target.s   };

  // 机关单位占多格，用体积间的最小距离判定
  const attackerHexes = (attacker.type === 'ballista' || attacker.type === 'chariot' || attacker.type === 'catapult')
    ? getMachineOccupiedHexes(attackerPos, attacker.type as 'ballista' | 'chariot' | 'catapult', attacker.owner === 'player1')
    : [attackerPos];

  const targetHexes = (target.type === 'ballista' || target.type === 'chariot' || target.type === 'catapult')
    ? getMachineOccupiedHexes(targetPos, target.type as 'ballista' | 'chariot' | 'catapult', target.owner === 'player1')
    : [targetPos];

  let minBodyDist = Infinity;
  for (const a of attackerHexes) {
    for (const t of targetHexes) {
      const d = hexDistance(a, t);
      if (d < minBodyDist) minBodyDist = d;
    }
  }

  // 近战单位：必须与目标体积相邻
  if (attacker.type === 'infantry' || attacker.type === 'cavalry' || attacker.type === 'general') {
    if (minBodyDist > 1) {
      return { ok: false, reason: "目标不在攻击范围内" };
    }
  }

  // 弓箭手：射程 = 3 + 距己方基线距离
  if (attacker.type === 'archer') {
    const playerSide = attacker.owner === 'player1' ? 'top' : 'bottom';
    const maxRange = 3 + getDistanceToBaseline(attackerPos, playerSide);
    if (minBodyDist > maxRange) {
      return { ok: false, reason: "目标超出射程" };
    }
  }

  // 投石车：沿当前朝向的直线射击，射程 5
  //
  // 这个限制以前只存在于客户端的高亮计算里，服务端一侧完全没有射程判定
  // —— 也就是说投石车可以隔着整张图打对角（实测距离 10 也被接受）。
  // 这里把客户端一直在执行的规则补到服务端。
  if (attacker.type === 'catapult') {
    const path = getShootingPath(attackerPos, attacker.direction, 5);
    const onPath = path.some(hex => targetHexes.some(t => hexEquals(hex, t)));
    if (!onPath) {
      return { ok: false, reason: "目标不在投石车射击方向上" };
    }
  }

  // 弩车有专用的贯穿 / 近战指令（handleBallistaPierceAttack、handleBallistaMeleeAttack），
  // 不走这条普通攻击路径；战车靠移动碾压，没有攻击动作。
  // 之前这两类会落到「没有任何射程判定」的分支里，等于全图可攻击。
  if (attacker.type === 'ballista') {
    return { ok: false, reason: "弩车请使用贯穿或近战攻击" };
  }
  if (attacker.type === 'chariot') {
    return { ok: false, reason: "战车没有攻击动作" };
  }

  // 弓箭手射击路径经过友军：行动点额外 +1（不阻止攻击）
  let archerBlocked = false;
  if (attacker.type === 'archer') {
    const intermediateHexes = hexLineDraw(attackerPos, targetPos).slice(1, -1);
    archerBlocked = intermediateHexes.some(hex =>
      units.some(u =>
        u.owner === attacker.owner && u.q === hex.q && u.r === hex.r && u.s === hex.s
      )
    );
  }

  // 攻击将领消耗 2 点，其他 1 点
  const cost = (target.type === "general" ? 2 : 1) + (archerBlocked ? 1 : 0);
  return { ok: true, cost, archerBlocked };
}

/**
 * 列出某个单位当前可以攻击的所有目标 id。
 * 与对应的 handle* 共用同一个谓词，所以不会和校验结果不一致。
 */
/* ══════════════════ 伤害预测 ══════════════════
 *
 * 这三个函数是**纯查询**，从 handleAttack 里抽出来的，目的是让
 * 「客户端画的致命提示」和「服务端实际结算的伤害」用同一份计算。
 *
 * 抽的时候只搬了判定，没搬副作用：纵深抗击触发后的击退、设置移动限制、
 * 写战报仍然留在 handleAttack —— 它需要 findRearInfantrySupport 返回的列表，
 * 而预测只需要「列表非空」这个布尔值。一份实现，两个用途。
 */

/**
 * 纵深抗击的支援队列：被弓箭手攻击的步兵，其**背离攻击者方向**的轴线上
 * 连续排列的己方步兵。
 *
 * 「连续」很关键：一旦遇到空格或非己方步兵就停，不能跳过缺口。
 * 返回值按距攻击者的距离升序，调用方取最远的那个做击退。
 */
export function findRearInfantrySupport(
  attacker: UnitLike,
  target: UnitLike,
  units: readonly UnitLike[]
): Array<{ unit: UnitLike; distance: number }> {
  if (target.type !== 'infantry' || attacker.type !== 'archer') return [];

  const targetCell = { q: target.q, r: target.r, s: target.s };
  const sourceCell = { q: attacker.q, r: attacker.r, s: attacker.s };
  const out: Array<{ unit: UnitLike; distance: number }> = [];

  for (const hex of getAxisLineFromTarget(targetCell, sourceCell, MAP_RADIUS)) {
    const unit = units.find(u =>
      u.owner === target.owner && u.type === 'infantry' &&
      u.q === hex.q && u.r === hex.r && u.s === hex.s
    );
    if (!unit) break; // 不连续就停
    out.push({ unit, distance: hexDistance(hex, sourceCell) });
  }
  return out;
}

/** 目标是否触发纵深抗击（免掉这次伤害） */
export function isDepthDefended(
  attacker: UnitLike,
  target: UnitLike,
  units: readonly UnitLike[]
): boolean {
  return findRearInfantrySupport(attacker, target, units).length > 0;
}

/**
 * 目标相邻的己方步兵数量。
 * ≥2 时「步兵护卫」生效，抵消骑兵的冲锋伤害加成。
 */
export function adjacentFriendlyInfantryCount(
  target: UnitLike,
  units: readonly UnitLike[]
): number {
  const pos = { q: target.q, r: target.r, s: target.s };
  return hexNeighbors(pos).filter(n =>
    units.some(u =>
      u.owner === target.owner && u.type === 'infantry' &&
      u.q === n.q && u.r === n.r && u.s === n.s
    )
  ).length;
}

/**
 * 预测一次普通攻击造成的伤害。
 *
 *   基础 1
 *   骑兵本回合移动满 2 格 → +1，但目标相邻己方步兵 ≥2 时该加成被抵消
 *   触发纵深抗击 → 0
 *
 * 注意这只覆盖 handleAttack 的普通攻击路径；弩车贯穿、投石车溅射、
 * 无双扇形各有自己的结算，不走这里。
 */
export function predictDamage(
  attacker: UnitLike,
  target: UnitLike,
  units: readonly UnitLike[]
): number {
  if (isDepthDefended(attacker, target, units)) return 0;

  let damage = 1;
  if (attacker.type === 'cavalry' && attacker.moveDistance === 2) {
    if (adjacentFriendlyInfantryCount(target, units) < 2) damage += 1;
  }
  return damage;
}

/** 这一下能否击杀 —— 客户端据此把矛尖画成实心 */
export function isLethal(
  attacker: UnitLike,
  target: UnitLike,
  units: readonly UnitLike[]
): boolean {
  const dmg = predictDamage(attacker, target, units);
  return dmg > 0 && target.hp <= dmg;
}

export function getAttackableTargets(unit: UnitLike, units: readonly UnitLike[]): string[] {
  const out: string[] = [];
  units.forEach(other => {
    if (other.id === unit.id) return;
    // 只排除同阵营。中立单位也算可攻击目标 ——
    // handleAttackUnit 并不拒绝攻击中立单位，这里必须和它保持一致，
    // 否则又造出一处「服务端允许但界面不高亮」的新分歧。
    if (other.owner === unit.owner) return;

    // 弩车走近战谓词，其余走普通攻击谓词
    const ok = unit.type === 'ballista'
      ? checkBallistaMeleeLegality(unit, other, units).ok
      : checkAttackLegality(unit, other, units).ok;
    if (ok) out.push(other.id);
  });
  return out;
}

/**
 * 计算单位的合法移动位置
 * 对于骑兵，返回带有步数信息的结果
 */
export function getValidMoves(unit: UnitLike, units: readonly UnitLike[]): { q: number; r: number; s: number; steps?: number }[] {
  const MAP_RADIUS = 5;

  // 计算行动次数上限（基础2次 + 额外行动次数）
  const bonusActions = (unit.type === 'general' && unit.bonusActionLimit) ? unit.bonusActionLimit : 0;
  const actionLimit = 2 + bonusActions;

  // 检查是否已达到行动次数上限
  if (unit.actionsThisTurn >= actionLimit) {
    return [];
  }

  // 检查是否有无限行动标志（无双技能）
  const hasUnlimitedActions = unit.type === 'general' && unit.unlimitedActions;

  // 如果没有无限行动且没有额外行动次数，按照原来的规则：移动过就不能再移动
  if (!hasUnlimitedActions && bonusActions === 0 && unit.hasMoved) {
    return [];
  }

  const unitPos = { q: unit.q, r: unit.r, s: unit.s };

  // 战车特殊移动逻辑
  if (unit.type === 'chariot') {
    // 检查是否已行动
    if (unit.hasActedThisTurn) return [];

    // 根据玩家方向确定移动方向
    const dir1 = unit.owner === 'player1' ? 2 : 5; // NORTH_WEST : SOUTH_WEST
    const dir2 = unit.owner === 'player1' ? 1 : 4; // NORTH_EAST : SOUTH_EAST

    // 战车有3种移动终点：
    // 1. 正前方（先dir1后dir2）
    const mid_forward = hexNeighbor(unitPos, dir1);
    const end_forward = hexNeighbor(mid_forward, dir2);

    // 2. 左侧（两次dir1）
    const mid_left = hexNeighbor(unitPos, dir1);
    const end_left = hexNeighbor(mid_left, dir1);

    // 3. 右侧（两次dir2）
    const mid_right = hexNeighbor(unitPos, dir2);
    const end_right = hexNeighbor(mid_right, dir2);

    // 战车可以碾压敌人，检查每个终点的所有占用格子是否都在地图范围内
    const endpoints = [end_forward, end_left, end_right];
    return endpoints.filter(hex => {
      const occupiedHexes = getMachineOccupiedHexes(hex, 'chariot');
      return occupiedHexes.every(occupiedHex => isInMapRange(occupiedHex, MAP_RADIUS));
    });
  }

  // 弩车特殊移动逻辑：不能碾压，需要检查所有占用格子
  if (unit.type === 'ballista') {
    // 检查是否已行动
    if (unit.hasActedThisTurn) return [];

    const range = 1;
    const possibleMoves = hexRange(unitPos, range);

    // 过滤移动位置：需要检查弩车占用的所有3格都没有障碍物
    return possibleMoves.filter(hex => {
      if (hexEquals(hex, unitPos)) return false;

      // 检查目标位置及其占用的所有格子
      const targetOccupiedHexes = getMachineOccupiedHexes(hex, 'ballista');

      // 检查是否有任何格子被占用
      const hasCollision = targetOccupiedHexes.some(occupiedHex => {
        let isOccupied = false;
        units.forEach(u => {
          if (u.id !== unit.id && hexEquals({ q: u.q, r: u.r, s: u.s }, occupiedHex)) {
            isOccupied = true;
          }
        });
        return isOccupied;
      });

      // 整个车身都必须在棋盘内，和战车分支（1383 行附近）保持一致。
      // 原来这里既没查中心格也没查车身：hexRange 只按距离生成候选格、不裁剪边界，
      // 弩车能走到棋盘外，或者中心在内、车身有一格伸出棋盘
      //（全地图统计：480 个落点里有 60 个属于后者）。
      // 伸出去的那一格既画不出来也打不到，所以不该算合法落点。
      const allInMap = targetOccupiedHexes.every(h => isInMapRange(h, MAP_RADIUS));

      return !hasCollision && allInMap && hexDistance(unitPos, hex) <= range;
    });
  }

  // 投石车特殊移动逻辑：每回合最多行动2次（含移动、蓄力、攻击），用 actionsThisTurn 计数
  if (unit.type === 'catapult') {
    if (unit.actionsThisTurn >= 2) return [];

    const catapultPossibleMoves = hexRange(unitPos, 1);
    return catapultPossibleMoves.filter(hex => {
      if (hexEquals(hex, unitPos)) return false;
      let occupied = false;
      units.forEach(u => {
        if (u.id !== unit.id && hexEquals({ q: u.q, r: u.r, s: u.s }, hex)) {
          occupied = true;
        }
      });
      if (isHexOccupiedByMachine(hex, units)) occupied = true;

      // 整个车身都必须在棋盘内，和战车/弩车分支一致。
      // 只查中心格的话，会有落点让投石车的车身伸出棋盘一格
      //（全地图统计：480 个落点里 60 个属于这种），那一格画不出来也打不到。
      const bodyInMap = getMachineOccupiedHexes(hex, 'catapult', unit.owner === 'player1')
        .every(h => isInMapRange(h, MAP_RADIUS));

      return !occupied && bodyInMap;
    });
  }

  // 普通单位移动逻辑
  const range = unit.type === 'cavalry' ? 3 : 1; // 骑兵最多移动3格

  // 仁德将军本身移动范围+1（不适用于其他单位）
  let finalRange = range;
  if (unit.type === 'general' && unit.generalType === 'rende') {
    finalRange = range + 1;
  }

  // 对于骑兵，使用BFS计算所有可达的格子（考虑路径阻挡）
  if (unit.type === 'cavalry') {
    const reachable = new Map<string, number>(); // key: "q,r,s", value: 到达该格子的最短步数
    const queue: Array<{ pos: HexCoord, steps: number }> = [];
    const visited = new Set<string>();

    // 起点
    queue.push({ pos: unitPos, steps: 0 });
    visited.add(`${unitPos.q},${unitPos.r},${unitPos.s}`);

    while (queue.length > 0) {
      const current = queue.shift()!;

      // 如果已经达到移动上限，不再展开
      if (current.steps >= range) continue;

      // 获取所有相邻格子
      const neighbors = hexNeighbors(current.pos);

      for (const neighbor of neighbors) {
        const neighborKey = `${neighbor.q},${neighbor.r},${neighbor.s}`;

        // 如果已访问过，跳过
        if (visited.has(neighborKey)) continue;

        // 检查是否在地图范围内
        if (!isInMapRange(neighbor, MAP_RADIUS)) continue;

        // 检查是否被占用
        let occupied = false;
        for (const u of units) {
          if (hexEquals({ q: u.q, r: u.r, s: u.s }, neighbor) && u.id !== unit.id) {
            occupied = true;
            break;
          }
        }

        // 检查是否被机关单位占据
        if (isHexOccupiedByMachine(neighbor, units)) {
          occupied = true;
        }

        // 如果被占用，这条路径不通，但继续尝试其他路径
        if (occupied) {
          visited.add(neighborKey); // 标记为已访问，避免重复检查
          continue;
        }

        // 标记为已访问并加入队列
        visited.add(neighborKey);
        const nextSteps = current.steps + 1;
        queue.push({ pos: neighbor, steps: nextSteps });

        // 记录到达该格子的最短步数
        if (!reachable.has(neighborKey)) {
          reachable.set(neighborKey, nextSteps);
        }
      }
    }

    // 将结果转换为数组格式
    const result: { q: number; r: number; s: number; steps: number }[] = [];
    for (const [key, steps] of reachable.entries()) {
      const [q, r, s] = key.split(',').map(Number);
      result.push({ q, r, s, steps });
    }

    return result;
  }

  // 非骑兵单位的移动逻辑
  const possibleMoves = hexRange(unitPos, finalRange);

  // 过滤掉已被占用的位置和不在地图范围内的位置
  return possibleMoves.filter(hex => {
    if (hexEquals(hex, unitPos)) return false;

    // 检查是否有其他单位占用（包括单位本身和机关单位占据的格子）
    let occupied = false;
    units.forEach(u => {
      if (hexEquals({ q: u.q, r: u.r, s: u.s }, hex) && u.id !== unit.id) {
        occupied = true;
      }
    });

    // 检查是否被机关单位占据（机关单位的所有格子都是实体）
    if (isHexOccupiedByMachine(hex, units)) {
      occupied = true;
    }

    // 检查步兵纵深抗击的移动限制
    if (unit.movementRestricted && unit.type === 'infantry') {
      console.log(`[服务端移动验证] 单位被限制 - ID: ${unit.id}, movementRestricted: ${unit.movementRestricted}`);
      const restrictionSource = {
        q: unit.movementRestrictionSourceQ,
        r: unit.movementRestrictionSourceR,
        s: unit.movementRestrictionSourceS
      };

      console.log(`[服务端移动验证] 限制来源:`, restrictionSource);
      console.log(`[服务端移动验证] 当前位置:`, unitPos);
      console.log(`[服务端移动验证] 目标位置:`, hex);

      // 计算到限制来源的距离
      const currentDistance = hexDistance(unitPos, restrictionSource);
      const newDistance = hexDistance(hex, restrictionSource);

      console.log(`[服务端移动验证] 当前距离: ${currentDistance}, 新距离: ${newDistance}`);

      // 如果移动后距离变小（朝向敌人），禁止移动
      if (newDistance < currentDistance) {
        console.log(`[服务端移动验证] 禁止移动！距离变小`);
        return false;
      }
    }

    // isInMapRange 不能漏：possibleMoves 来自 hexRange，它只按距离生成候选格、
    // 不裁剪地图边界。少了这一步，处在棋盘边缘的步兵/弓箭手/将领
    // 可以走到棋盘外（handleMoveUnit 正是拿这里的结果做合法性校验的）。
    return !occupied && isInMapRange(hex, MAP_RADIUS) && hexDistance(unitPos, hex) <= finalRange;
  });
}
