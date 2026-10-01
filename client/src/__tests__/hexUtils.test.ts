import { describe, expect, it } from 'vitest';
import { Direction } from '../../../shared/types';
import type { HexCoord } from '../../../shared/types';
import {
  createHex,
  generateHexMap,
  getAxisDirection,
  getAxisLineFromTarget,
  getBallistaVerticalPath,
  getCatapultSplashTargets,
  getDistanceToBaseline,
  getFanShapedHexes,
  getMachineOccupiedHexes,
  getShootingPath,
  hexDistance,
  hexEquals,
  hexLineDraw,
  hexNeighbor,
  hexNeighbors,
  hexRange,
  hexRound,
  isInBattleZone,
  isInDirection,
  isInMapRange,
  isInStartZone,
  isValidHex,
  knockbackInfantryChain,
  tryKnockback,
} from '../../../shared/utils/hexUtils';

/**
 * shared/utils/hexUtils.ts 的单元测试
 *
 * 这个文件是全项目 bug 最集中的地方（见 commit 8cd8a2a
 * 「修复多个游戏逻辑 bug：骑兵/投石车/弩车/弓箭手/散架步兵」），
 * 而它全是纯函数，没有 React、没有网络，是最该先测的部分。
 *
 * 测试以「不变量 + 规则」为主，而不是把当前输出抄成期望值——
 * 后者只会把现有 bug 固化成测试。
 */

/** 本项目的地图半径。91 格 = 3·5² + 3·5 + 1 */
const MAP_RADIUS = 5;

const H = (q: number, r: number) => createHex(q, r);
const ORIGIN = H(0, 0);

/** 把坐标列表转成可比较的字符串集合 */
const keys = (hexes: HexCoord[]) => new Set(hexes.map(h => `${h.q},${h.r},${h.s}`));

const ALL_DIRECTIONS = [
  Direction.EAST,
  Direction.NORTH_EAST,
  Direction.NORTH_WEST,
  Direction.WEST,
  Direction.SOUTH_WEST,
  Direction.SOUTH_EAST,
];

describe('立方坐标基础不变量', () => {
  it('createHex 生成的坐标满足 q + r + s = 0', () => {
    for (let q = -6; q <= 6; q++) {
      for (let r = -6; r <= 6; r++) {
        const h = createHex(q, r);
        expect(h.q + h.r + h.s).toBe(0);
        expect(isValidHex(h)).toBe(true);
      }
    }
  });

  it('isValidHex 拒绝不满足约束的坐标', () => {
    expect(isValidHex({ q: 1, r: 1, s: 1 })).toBe(false);
    expect(isValidHex({ q: 1, r: 1, s: -2 })).toBe(true);
  });

  it('hexDistance 自反、对称、且满足三角不等式', () => {
    const samples = [ORIGIN, H(3, -1), H(-2, 4), H(5, -5), H(-4, 2)];
    for (const a of samples) {
      expect(hexDistance(a, a)).toBe(0);
      for (const b of samples) {
        expect(hexDistance(a, b)).toBe(hexDistance(b, a));
        for (const c of samples) {
          expect(hexDistance(a, c)).toBeLessThanOrEqual(hexDistance(a, b) + hexDistance(b, c));
        }
      }
    }
  });

  it('hexDistance 与已知数值一致', () => {
    expect(hexDistance(ORIGIN, H(1, 0))).toBe(1);
    expect(hexDistance(ORIGIN, H(2, -1))).toBe(2);
    expect(hexDistance(ORIGIN, H(0, 3))).toBe(3);
    expect(hexDistance(H(2, -2), H(-1, 1))).toBe(3);
  });
});

describe('邻居与方向', () => {
  it('hexNeighbors 返回 6 个互不相同、距离均为 1 的格子', () => {
    const ns = hexNeighbors(H(2, -1));
    expect(ns).toHaveLength(6);
    expect(keys(ns).size).toBe(6);
    for (const n of ns) {
      expect(hexDistance(H(2, -1), n)).toBe(1);
      expect(isValidHex(n)).toBe(true);
    }
  });

  it('每个方向的邻居都恰好距离 1', () => {
    for (const d of ALL_DIRECTIONS) {
      expect(hexDistance(ORIGIN, hexNeighbor(ORIGIN, d))).toBe(1);
    }
  });

  it('相反方向互为逆运算（方向 d 与 d+3 相反）', () => {
    for (const d of ALL_DIRECTIONS) {
      const opposite = ((d + 3) % 6) as Direction;
      const there = hexNeighbor(ORIGIN, d);
      const back = hexNeighbor(there, opposite);
      expect(hexEquals(back, ORIGIN)).toBe(true);
    }
  });

  it('hexNeighbor 与 hexNeighbors 结果一致', () => {
    const viaEach = ALL_DIRECTIONS.map(d => hexNeighbor(H(-1, 2), d));
    expect(keys(viaEach)).toEqual(keys(hexNeighbors(H(-1, 2))));
  });
});

describe('地图范围与分区', () => {
  it('generateHexMap(5) 生成 91 格，全部合法且在范围内', () => {
    const map = generateHexMap(MAP_RADIUS);
    // 六边形格数公式 3n² + 3n + 1
    expect(map).toHaveLength(3 * MAP_RADIUS * MAP_RADIUS + 3 * MAP_RADIUS + 1);
    expect(keys(map).size).toBe(map.length);
    for (const h of map) {
      expect(isValidHex(h)).toBe(true);
      expect(isInMapRange(h, MAP_RADIUS)).toBe(true);
    }
  });

  it('isInMapRange 在边界上的行为', () => {
    expect(isInMapRange(H(5, 0), 5)).toBe(true);
    expect(isInMapRange(H(6, 0), 5)).toBe(false);
    // s 越界也要被拒：q=3,r=3 -> s=-6
    expect(isInMapRange(H(3, 3), 5)).toBe(false);
  });

  it('起始区与交战区把地图完整划分，且互不重叠', () => {
    for (const h of generateHexMap(MAP_RADIUS)) {
      const top = isInStartZone(h, 'top');
      const bottom = isInStartZone(h, 'bottom');
      const battle = isInBattleZone(h);
      // 恰好属于三者之一
      expect([top, bottom, battle].filter(Boolean)).toHaveLength(1);
    }
  });

  it('起始区是各自的 3 排（r >= 3 / r <= -3）', () => {
    expect(isInStartZone(H(0, 3), 'top')).toBe(true);
    expect(isInStartZone(H(0, 2), 'top')).toBe(false);
    expect(isInStartZone(H(0, -3), 'bottom')).toBe(true);
    expect(isInStartZone(H(0, -2), 'bottom')).toBe(false);
  });

  it('getDistanceToBaseline 在自家底线上为 0，越靠前越大', () => {
    // top 方底线是 r 最大处
    const d0 = getDistanceToBaseline(H(0, 5), 'top');
    const d1 = getDistanceToBaseline(H(0, 4), 'top');
    expect(d1).toBeGreaterThan(d0);

    const e0 = getDistanceToBaseline(H(0, -5), 'bottom');
    const e1 = getDistanceToBaseline(H(0, -4), 'bottom');
    expect(e1).toBeGreaterThan(e0);
  });
});

describe('直线与取整', () => {
  it('hexRound 的结果始终是合法立方坐标', () => {
    const fracs = [
      { q: 0.4, r: -0.2, s: -0.2 },
      { q: 1.6, r: -0.9, s: -0.7 },
      { q: -2.5, r: 1.5, s: 1.0 },
      { q: 0.5, r: 0.5, s: -1.0 },
    ];
    for (const f of fracs) {
      const rounded = hexRound(f);
      expect(rounded.q + rounded.r + rounded.s).toBe(0);
    }
  });

  it('hexLineDraw 首尾正确、长度为距离+1、相邻两格距离为 1', () => {
    const pairs: [HexCoord, HexCoord][] = [
      [ORIGIN, H(3, 0)],
      [ORIGIN, H(0, -4)],
      [H(-2, 3), H(2, -1)],
      [H(1, 1), H(-3, 2)],
    ];
    for (const [a, b] of pairs) {
      const path = hexLineDraw(a, b);
      expect(path).toHaveLength(hexDistance(a, b) + 1);
      expect(hexEquals(path[0], a)).toBe(true);
      expect(hexEquals(path[path.length - 1], b)).toBe(true);
      for (let i = 1; i < path.length; i++) {
        expect(hexDistance(path[i - 1], path[i])).toBe(1);
      }
    }
  });

  it('hexLineDraw 到自身返回单点', () => {
    expect(hexLineDraw(H(2, 2), H(2, 2))).toHaveLength(1);
  });

  it('isInDirection 只对该方向直线上的目标为真', () => {
    // 正东方向 3 格
    const east3 = H(3, 0);
    expect(isInDirection(ORIGIN, east3, Direction.EAST)).toBe(true);
    expect(isInDirection(ORIGIN, east3, Direction.WEST)).toBe(false);
    // 自身不算
    expect(isInDirection(ORIGIN, ORIGIN, Direction.EAST)).toBe(false);
  });
});

describe('hexRange', () => {
  it('范围 n 内含 3n²+3n+1 格，且全部距离 <= n', () => {
    for (const n of [1, 2, 3]) {
      const hexes = hexRange(H(1, -1), n);
      expect(hexes).toHaveLength(3 * n * n + 3 * n + 1);
      for (const h of hexes) {
        expect(hexDistance(H(1, -1), h)).toBeLessThanOrEqual(n);
      }
    }
  });

  it('包含中心自身', () => {
    const center = H(-2, 1);
    expect(keys(hexRange(center, 2)).has(`${center.q},${center.r},${center.s}`)).toBe(true);
  });
});

describe('弓箭手射击路径 getShootingPath', () => {
  it('无阻挡时长度等于射程，且沿同一方向递增', () => {
    const path = getShootingPath(ORIGIN, Direction.EAST, 3);
    expect(path).toHaveLength(3);
    path.forEach((h, i) => {
      expect(hexDistance(ORIGIN, h)).toBe(i + 1);
    });
  });

  it('不包含起点', () => {
    const path = getShootingPath(ORIGIN, Direction.EAST, 3);
    expect(path.some(h => hexEquals(h, ORIGIN))).toBe(false);
  });

  it('遇到阻挡时包含该格并停止', () => {
    const blocker = H(2, 0);
    const path = getShootingPath(ORIGIN, Direction.EAST, 5, [blocker]);
    expect(path).toHaveLength(2);
    expect(hexEquals(path[path.length - 1], blocker)).toBe(true);
  });

  it('射程被地图边界截断', () => {
    // 从东侧边缘再往东只剩 1 格
    const path = getShootingPath(H(4, 0), Direction.EAST, 5);
    expect(path).toHaveLength(1);
    for (const h of path) {
      expect(isInMapRange(h, MAP_RADIUS)).toBe(true);
    }
  });
});

describe('弩车垂直贯穿 getBallistaVerticalPath', () => {
  it('玩家1向北推进，每格 r 减 2', () => {
    const path = getBallistaVerticalPath(H(0, 4), true, MAP_RADIUS);
    expect(path.length).toBeGreaterThan(0);
    let prev = H(0, 4);
    for (const h of path) {
      expect(h.r).toBe(prev.r - 2);
      expect(h.q).toBe(prev.q + 1);
      expect(isValidHex(h)).toBe(true);
      prev = h;
    }
  });

  it('玩家2向南推进，每格 r 加 2', () => {
    const path = getBallistaVerticalPath(H(0, -4), false, MAP_RADIUS);
    expect(path.length).toBeGreaterThan(0);
    let prev = H(0, -4);
    for (const h of path) {
      expect(h.r).toBe(prev.r + 2);
      expect(h.q).toBe(prev.q - 1);
      prev = h;
    }
  });

  it('路径全部在地图内，且不含起点', () => {
    const from = H(0, 4);
    const path = getBallistaVerticalPath(from, true, MAP_RADIUS);
    expect(path.some(h => hexEquals(h, from))).toBe(false);
    for (const h of path) {
      expect(isInMapRange(h, MAP_RADIUS)).toBe(true);
    }
  });

  it('在边界外的起点得到空路径而不是死循环', () => {
    const path = getBallistaVerticalPath(H(5, -5), true, MAP_RADIUS);
    expect(Array.isArray(path)).toBe(true);
  });
});

describe('无双扇形攻击 getFanShapedHexes', () => {
  it('返回中心方向 + 左右各 60° 共 3 格，全部与起点相邻', () => {
    for (const d of ALL_DIRECTIONS) {
      const hexes = getFanShapedHexes(ORIGIN, d, 1, MAP_RADIUS);
      expect(hexes).toHaveLength(3);
      expect(keys(hexes).size).toBe(3);
      for (const h of hexes) {
        expect(hexDistance(ORIGIN, h)).toBe(1);
      }
    }
  });

  it('扇形恰好是中心方向 ± 60°，不是别的三格', () => {
    // 这条是 120° 扇形的定义。只断言「3 格且都相邻」不够：
    // 把左臂从 +60° 改成 +120° 也能满足那个条件，但扇形形状已经错了。
    for (const d of ALL_DIRECTIONS) {
      const expected = keys([
        hexNeighbor(ORIGIN, ((d + 5) % 6) as Direction), // 左 60°
        hexNeighbor(ORIGIN, d),                          // 中心
        hexNeighbor(ORIGIN, ((d + 1) % 6) as Direction), // 右 60°
      ]);
      expect(keys(getFanShapedHexes(ORIGIN, d, 1, MAP_RADIUS)), `方向 ${d}`).toEqual(expected);
    }
  });

  it('三格互相连续（两两之间最远 1 格，构成连贯扇面）', () => {
    for (const d of ALL_DIRECTIONS) {
      const hexes = getFanShapedHexes(ORIGIN, d, 1, MAP_RADIUS);
      const center = hexNeighbor(ORIGIN, d);
      // 左右两臂都必须与中心臂相邻
      for (const h of hexes) {
        expect(hexDistance(center, h)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('越界的格子被剔除', () => {
    // 地图东侧边缘朝东扇形，部分格子出界
    const hexes = getFanShapedHexes(H(5, 0), Direction.EAST, 1, MAP_RADIUS);
    expect(hexes.length).toBeLessThan(3);
    for (const h of hexes) {
      expect(isInMapRange(h, MAP_RADIUS)).toBe(true);
    }
  });
});

describe('机关占格 getMachineOccupiedHexes', () => {
  it('弩车占 3 格、战车占 4 格、投石车占 3 格，且都含中心', () => {
    const cases: [Parameters<typeof getMachineOccupiedHexes>[1], number][] = [
      ['ballista', 3],
      ['chariot', 4],
      ['catapult', 3],
    ];
    for (const [type, count] of cases) {
      const hexes = getMachineOccupiedHexes(ORIGIN, type, true);
      expect(hexes, type).toHaveLength(count);
      expect(keys(hexes).size, type).toBe(count);
      expect(hexes.some(h => hexEquals(h, ORIGIN)), type).toBe(true);
      // 所有占格都与中心相邻（或就是中心）
      for (const h of hexes) {
        expect(hexDistance(ORIGIN, h)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('弩车是倒 V（占格在后方），投石车是 V（占格在前方）——两个玩家镜像', () => {
    const b1 = getMachineOccupiedHexes(ORIGIN, 'ballista', true);
    const b2 = getMachineOccupiedHexes(ORIGIN, 'ballista', false);
    // 玩家1的弩车后方 r 更大，玩家2相反
    expect(b1.filter(h => h.r > 0)).toHaveLength(2);
    expect(b2.filter(h => h.r < 0)).toHaveLength(2);

    const c1 = getMachineOccupiedHexes(ORIGIN, 'catapult', true);
    const c2 = getMachineOccupiedHexes(ORIGIN, 'catapult', false);
    expect(c1.filter(h => h.r < 0)).toHaveLength(2);
    expect(c2.filter(h => h.r > 0)).toHaveLength(2);
  });

  it('省略 isPlayerOne 时退化为玩家1的形状（兼容旧调用）', () => {
    expect(keys(getMachineOccupiedHexes(ORIGIN, 'ballista'))).toEqual(
      keys(getMachineOccupiedHexes(ORIGIN, 'ballista', true))
    );
  });
});

describe('轴线 getAxisDirection / getAxisLineFromTarget', () => {
  it('同轴上的两点能识别出轴与方向', () => {
    // q 相同 -> 沿 q 轴
    const res = getAxisDirection(ORIGIN, H(0, 3));
    expect(res).not.toBeNull();
    expect(res!.axis).toBe('q');
    expect(res!.direction).toBe(1);
  });

  it('不在任何轴线上时返回 null', () => {
    // (1,1) 相对原点：dq=1, dr=1, ds=-2，三个都不为 0
    expect(getAxisDirection(ORIGIN, H(1, 1))).toBeNull();
  });

  it('getAxisLineFromTarget 返回的格子都在地图内且合法', () => {
    const line = getAxisLineFromTarget(H(0, 2), ORIGIN, MAP_RADIUS);
    for (const h of line) {
      expect(isValidHex(h)).toBe(true);
      expect(isInMapRange(h, MAP_RADIUS)).toBe(true);
    }
  });
});

describe('击退 tryKnockback', () => {
  const never = () => false;
  const always = () => true;

  it('沿来源→目标的轴线退一格，结果与原位相邻且更远离来源', () => {
    const source = ORIGIN;
    const target = H(0, 1);
    const result = tryKnockback(target, source, MAP_RADIUS, never);
    expect(result).not.toBeNull();
    expect(hexDistance(target, result!)).toBe(1);
    expect(hexDistance(source, result!)).toBeGreaterThan(hexDistance(source, target));
  });

  it('目标不在轴线上时无法击退', () => {
    expect(tryKnockback(H(1, 1), ORIGIN, MAP_RADIUS, never)).toBeNull();
  });

  it('击退位置被占用时返回 null', () => {
    expect(tryKnockback(H(0, 1), ORIGIN, MAP_RADIUS, always)).toBeNull();
  });

  it('击退会越界时返回 null', () => {
    // 已在南侧边缘，再往南出界
    expect(tryKnockback(H(0, 5), H(0, 4), MAP_RADIUS, never)).toBeNull();
  });
});

describe('步兵击退传导 knockbackInfantryChain', () => {
  /** 用一张「位置 -> 单位」的表搭出棋盘，生成函数需要的两个回调 */
  function board(units: Array<{ id: string; type: string; at: HexCoord; owner?: string }>) {
    const byKey = new Map(
      units.map(u => [`${u.at.q},${u.at.r},${u.at.s}`, { id: u.id, type: u.type, owner: u.owner ?? 'player1' }])
    );
    const getUnitAtPosition = (pos: HexCoord) => byKey.get(`${pos.q},${pos.r},${pos.s}`) ?? null;
    const isPositionOccupied = (pos: HexCoord, excludeIds: string[]) => {
      const u = getUnitAtPosition(pos);
      return !!u && !excludeIds.includes(u.id);
    };
    return { getUnitAtPosition, isPositionOccupied };
  }

  it('不在击退轴线上时不产生任何结果', () => {
    const b = board([{ id: 'a', type: 'infantry', at: H(1, 1) }]);
    // (1,1) 相对原点三个坐标差都不为 0，不在轴线上
    const r = knockbackInfantryChain(H(1, 1), ORIGIN, MAP_RADIUS, b.getUnitAtPosition, b.isPositionOccupied);
    expect(r).toEqual([]);
  });

  it('单个步兵后方为空 —— 后退一格，不掉血', () => {
    const victim = H(0, 1);
    const b = board([{ id: 'a', type: 'infantry', at: victim }]);
    const r = knockbackInfantryChain(victim, ORIGIN, MAP_RADIUS, b.getUnitAtPosition, b.isPositionOccupied);
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('a');
    expect(r[0].takeDamage).toBeUndefined();
    expect(r[0].newPosition).toBeDefined();
    // 后退方向必须远离攻击来源
    expect(hexDistance(ORIGIN, r[0].newPosition!)).toBeGreaterThan(hexDistance(ORIGIN, victim));
    expect(hexDistance(victim, r[0].newPosition!)).toBe(1);
  });

  it('两个步兵连成一列 —— 整列一起后退（传导）', () => {
    const b = board([
      { id: 'a', type: 'infantry', at: H(0, 1) },
      { id: 'b', type: 'infantry', at: H(0, 2) },
    ]);
    const r = knockbackInfantryChain(H(0, 1), ORIGIN, MAP_RADIUS, b.getUnitAtPosition, b.isPositionOccupied);
    expect(r.map(x => x.id)).toEqual(['a', 'b']);
    // 两个都是位移，不是掉血
    for (const x of r) {
      expect(x.newPosition).toBeDefined();
      expect(x.takeDamage).toBeUndefined();
    }
    // a 顶到 b 原来的位置，b 再往后一格
    expect(hexEquals(r[0].newPosition!, H(0, 2))).toBe(true);
    expect(hexEquals(r[1].newPosition!, H(0, 3))).toBe(true);
  });

  it('后方被非步兵挡住 —— 当前步兵掉血且传导中止', () => {
    const b = board([
      { id: 'a', type: 'infantry', at: H(0, 1) },
      { id: 'wall', type: 'cavalry', at: H(0, 2) },
    ]);
    const r = knockbackInfantryChain(H(0, 1), ORIGIN, MAP_RADIUS, b.getUnitAtPosition, b.isPositionOccupied);
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({ id: 'a', takeDamage: true });
  });

  it('贴着地图边界 —— 无处可退，掉血', () => {
    const b = board([{ id: 'a', type: 'infantry', at: H(0, 5) }]);
    const r = knockbackInfantryChain(H(0, 5), H(0, 4), MAP_RADIUS, b.getUnitAtPosition, b.isPositionOccupied);
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({ id: 'a', takeDamage: true });
  });

  it('起点没有步兵时什么都不做', () => {
    const b = board([{ id: 'a', type: 'archer', at: H(0, 1) }]);
    const r = knockbackInfantryChain(H(0, 1), ORIGIN, MAP_RADIUS, b.getUnitAtPosition, b.isPositionOccupied);
    expect(r).toEqual([]);
  });
});

describe('投石车溅射 getCatapultSplashTargets', () => {
  // 攻击者在原点，目标在正东 2 格，击退方向为东
  const attacker = ORIGIN;
  const target = H(2, 0);

  it('未蓄力（0 层）—— 只溅射目标背后 1 格', () => {
    const t = getCatapultSplashTargets(attacker, target, 0, MAP_RADIUS);
    expect(t).toHaveLength(1);
    expect(hexDistance(target, t[0])).toBe(1);
    // 溅射格在目标「背后」，即比目标更远离攻击者
    expect(hexDistance(attacker, t[0])).toBeGreaterThan(hexDistance(attacker, target));
  });

  it('蓄力 1 层和 2 层 —— 目标背后 120° 扇形 3 格', () => {
    for (const charge of [1, 2]) {
      const t = getCatapultSplashTargets(attacker, target, charge, MAP_RADIUS);
      expect(t, `蓄力 ${charge} 层`).toHaveLength(3);
      expect(keys(t).size, `蓄力 ${charge} 层不应有重复`).toBe(3);
      for (const h of t) {
        expect(hexDistance(target, h)).toBe(1);
      }
    }
  });

  it('溅射格全部在地图内；贴边时数量减少', () => {
    // 目标已在东侧边缘，背后的扇形有格子出界
    const edgeTarget = H(5, 0);
    const t = getCatapultSplashTargets(ORIGIN, edgeTarget, 2, MAP_RADIUS);
    expect(t.length).toBeLessThan(3);
    for (const h of t) {
      expect(isInMapRange(h, MAP_RADIUS)).toBe(true);
    }
  });

  it('溅射格不包含目标自己', () => {
    for (const charge of [0, 1, 2]) {
      const t = getCatapultSplashTargets(attacker, target, charge, MAP_RADIUS);
      expect(t.some(h => hexEquals(h, target)), `蓄力 ${charge} 层`).toBe(false);
    }
  });
});
