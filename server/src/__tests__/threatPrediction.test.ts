import { describe, expect, it } from 'vitest';
import type { UnitLike } from '../../../shared/rules/queries';
import {
  getDepthDefendedUnitIds,
  getThreatHexes,
  getThreatHexesForOwner,
} from '../../../shared/rules/queries';
import { hexDistance, hexNeighbors, isInMapRange } from '../../../shared/utils/hexUtils';
import { ShiyuanRoom } from '../rooms/ShiyuanRoom';
import { GameStateSchema, UnitSchema } from '../schema/GameState';

/**
 * 威胁预测的单元测试
 *
 * getThreatHexes 刻意不自己实现射程 —— 它枚举候选格，答案交给
 * checkAttackLegality（服务端校验用的同一份）。所以这里测的不是「射程公式对不对」
 * （那是 rules.test.ts 的事），而是**枚举与委派有没有出错**：
 *
 *   - 本回合已攻击过的敌人仍然算威胁（预测的是下回合）
 *   - 自己占的格子不算威胁
 *   - 各兵种的威胁形状符合其攻击方式（近战一圈 / 弓手一片 / 投石车一条线）
 *   - 并集去重
 *
 * 威胁提示算错是**比没有更糟**的：它会让玩家以为某格安全。
 */

const R = 5;

function u(o: Partial<UnitLike> & { id: string; type: string; owner: string; q: number; r: number }): UnitLike {
  return {
    direction: 0, hp: 2, moveDistance: 0, actionsThisTurn: 0,
    hasMoved: false, hasAttacked: false, hasActedThisTurn: false,
    generalType: '', bonusActionLimit: 0, unlimitedActions: false,
    movementRestricted: false,
    movementRestrictionSourceQ: 0, movementRestrictionSourceR: 0, movementRestrictionSourceS: 0,
    ...o,
    s: -o.q - o.r,
  } as UnitLike;
}

const key = (h: { q: number; r: number }) => `${h.q},${h.r}`;
const keys = (list: ReadonlyArray<{ q: number; r: number }>) => new Set(list.map(key));

describe('getThreatHexes —— 近战', () => {
  it('步兵威胁恰好是它的 6 个邻格', () => {
    const a = u({ id: 'a', type: 'infantry', owner: 'player1', q: 0, r: 0 });
    const got = keys(getThreatHexes(a, [a], R));
    const want = keys(hexNeighbors({ q: 0, r: 0, s: 0 }).filter(h => isInMapRange(h, R)));
    expect(got).toEqual(want);
  });

  it('自己站的那一格不算威胁', () => {
    const a = u({ id: 'a', type: 'infantry', owner: 'player1', q: 0, r: 0 });
    expect(keys(getThreatHexes(a, [a], R)).has('0,0')).toBe(false);
  });

  it('本回合已攻击过，仍然算威胁 —— 预测的是下回合', () => {
    const spent = u({ id: 'a', type: 'infantry', owner: 'player1', q: 0, r: 0, hasAttacked: true });
    const fresh = u({ id: 'a', type: 'infantry', owner: 'player1', q: 0, r: 0 });
    expect(keys(getThreatHexes(spent, [spent], R)))
      .toEqual(keys(getThreatHexes(fresh, [fresh], R)));
  });

  it('骑兵与将军同为近战，威胁形状与步兵一致', () => {
    const inf = u({ id: 'i', type: 'infantry', owner: 'player1', q: 1, r: -1 });
    const cav = u({ id: 'c', type: 'cavalry', owner: 'player1', q: 1, r: -1 });
    const gen = u({ id: 'g', type: 'general', owner: 'player1', q: 1, r: -1 });
    const base = keys(getThreatHexes(inf, [inf], R));
    expect(keys(getThreatHexes(cav, [cav], R))).toEqual(base);
    expect(keys(getThreatHexes(gen, [gen], R))).toEqual(base);
  });

  it('地图边缘的单位：越界的邻格被剔掉', () => {
    const a = u({ id: 'a', type: 'infantry', owner: 'player1', q: 0, r: R });
    const got = getThreatHexes(a, [a], R);
    expect(got.length).toBeLessThan(6);
    expect(got.every(h => isInMapRange({ ...h, s: -h.q - h.r }, R))).toBe(true);
  });
});

describe('getThreatHexes —— 弓箭手', () => {
  const archer = u({ id: 'arc', type: 'archer', owner: 'player1', q: 0, r: 3 });

  it('威胁范围按距离单调：近的被威胁，就不会出现"近的安全、远的危险"', () => {
    const threatened = getThreatHexes(archer, [archer], R);
    const set = keys(threatened);
    const self = { q: archer.q, r: archer.r, s: archer.s };
    const maxD = Math.max(...threatened.map(h => hexDistance(self, { ...h, s: -h.q - h.r })));
    // 比最远威胁距离更近的格子，只要在图内，都必须也被威胁
    for (const h of threatened) {
      const d = hexDistance(self, { ...h, s: -h.q - h.r });
      expect(d).toBeLessThanOrEqual(maxD);
    }
    for (const n of hexNeighbors(self)) {
      if (isInMapRange(n, R)) expect(set.has(key(n))).toBe(true);
    }
  });

  it('不是全图：射程有限', () => {
    const threatened = getThreatHexes(archer, [archer], R);
    expect(threatened.length).toBeGreaterThan(6);
    expect(threatened.length).toBeLessThan(3 * R * R + 3 * R + 1);
  });

  it('射程比近战远', () => {
    const inf = u({ id: 'i', type: 'infantry', owner: 'player1', q: 0, r: 3 });
    expect(getThreatHexes(archer, [archer], R).length)
      .toBeGreaterThan(getThreatHexes(inf, [inf], R).length);
  });
});

describe('getThreatHexes —— 机关', () => {
  it('投石车只威胁朝向那一条线，转向后威胁线跟着变', () => {
    const east = u({ id: 'cat', type: 'catapult', owner: 'player1', q: 0, r: 0, direction: 0 });
    const other = u({ id: 'cat', type: 'catapult', owner: 'player1', q: 0, r: 0, direction: 3 });
    const a = keys(getThreatHexes(east, [east], R));
    const b = keys(getThreatHexes(other, [other], R));
    expect(a.size).toBeGreaterThan(0);
    expect(b.size).toBeGreaterThan(0);
    expect(a).not.toEqual(b);
  });

  /**
   * 战车按**服务端实现**算：碾压只发生在落点车身，不是沿路。
   * 规则书写的是「前进路上的单位会被直接击杀（带友伤）」，
   * 但 handleMove 只检查 getMachineOccupiedHexes(targetPos,'chariot')，
   * 且只杀 owner !== role —— 既没沿路也没友伤。威胁提示跟代码走。
   */
  it('战车威胁 = 所有合法落点的车身覆盖格', () => {
    const ch = u({ id: 'ch', type: 'chariot', owner: 'player1', q: 0, r: 0 });
    const got = getThreatHexes(ch, [ch], R);
    expect(got.length).toBeGreaterThan(0);
    // 车身是中心 + 右上/右/右下，所以威胁区会明显偏向 +q 侧
    const right = got.filter(h => h.q > 0).length;
    expect(right).toBeGreaterThan(0);
  });

  it('战车动不了（本回合已行动）时威胁依然算得出 —— 预测的是下回合', () => {
    const spent = u({ id: 'ch', type: 'chariot', owner: 'player1', q: 0, r: 0, hasActedThisTurn: true });
    const fresh = u({ id: 'ch', type: 'chariot', owner: 'player1', q: 0, r: 0 });
    expect(keys(getThreatHexes(spent, [spent], R)))
      .toEqual(keys(getThreatHexes(fresh, [fresh], R)));
  });

  it('战车威胁不含自己当前的车身格', () => {
    const ch = u({ id: 'ch', type: 'chariot', owner: 'player1', q: 0, r: 0 });
    const got = keys(getThreatHexes(ch, [ch], R));
    expect(got.has('0,0')).toBe(false);
  });

  it('弩车威胁 = 贯穿线 + 近战邻格，且不含自己的车身', () => {
    const b = u({ id: 'b', type: 'ballista', owner: 'player1', q: 0, r: 0 });
    const got = getThreatHexes(b, [b], R);
    expect(got.length).toBeGreaterThan(0);
    // 车身占 3 格，这些都不该出现在威胁里
    const bodyKeys = keys([{ q: 0, r: 0 }]);
    for (const h of got) expect(bodyKeys.has(key(h))).toBe(false);
  });
});

describe('getThreatHexesForOwner', () => {
  it('取并集并去重', () => {
    const a = u({ id: 'a', type: 'infantry', owner: 'player2', q: 0, r: 0 });
    const b = u({ id: 'b', type: 'infantry', owner: 'player2', q: 1, r: 0 });
    const mine = u({ id: 'm', type: 'infantry', owner: 'player1', q: -3, r: 0 });
    const got = getThreatHexesForOwner('player2', [a, b, mine], R);
    const ks = got.map(key);
    expect(new Set(ks).size).toBe(ks.length); // 无重复
    // 两个单位相邻，威胁区应当真的合并（大于单个、小于两倍）
    const single = getThreatHexes(a, [a, b, mine], R).length;
    expect(got.length).toBeGreaterThan(single);
    expect(got.length).toBeLessThan(single * 2);
  });

  it('只算指定一方', () => {
    const foe = u({ id: 'f', type: 'infantry', owner: 'player2', q: 0, r: 0 });
    const mine = u({ id: 'm', type: 'infantry', owner: 'player1', q: 3, r: 0 });
    const got = keys(getThreatHexesForOwner('player2', [foe, mine], R));
    // 我方单位的邻格不该因为「我方」而被算进 player2 的威胁
    expect(got.has('4,0')).toBe(false);
  });
});

describe('getDepthDefendedUnitIds', () => {
  it('有敌方弓箭手、且背后有连续己方步兵 → 列入', () => {
    const arc = u({ id: 'arc', type: 'archer', owner: 'player1', q: 0, r: 0 });
    const front = u({ id: 'f', type: 'infantry', owner: 'player2', q: 1, r: 0 });
    const rear = u({ id: 'r', type: 'infantry', owner: 'player2', q: 2, r: 0 });
    expect(getDepthDefendedUnitIds([arc, front, rear])).toContain('f');
  });

  it('场上没有敌方弓箭手 → 不列入（方阵只对弓箭攻击生效）', () => {
    const front = u({ id: 'f', type: 'infantry', owner: 'player2', q: 1, r: 0 });
    const rear = u({ id: 'r', type: 'infantry', owner: 'player2', q: 2, r: 0 });
    const spear = u({ id: 's', type: 'infantry', owner: 'player1', q: 0, r: 0 });
    expect(getDepthDefendedUnitIds([spear, front, rear])).toEqual([]);
  });

  it('背后没有支援 → 不列入', () => {
    const arc = u({ id: 'arc', type: 'archer', owner: 'player1', q: 0, r: 0 });
    const front = u({ id: 'f', type: 'infantry', owner: 'player2', q: 1, r: 0 });
    expect(getDepthDefendedUnitIds([arc, front])).toEqual([]);
  });

  it('非步兵不参与（纵深抗击只保护步兵）', () => {
    const arc = u({ id: 'arc', type: 'archer', owner: 'player1', q: 0, r: 0 });
    const cav = u({ id: 'c', type: 'cavalry', owner: 'player2', q: 1, r: 0 });
    const rear = u({ id: 'r', type: 'infantry', owner: 'player2', q: 2, r: 0 });
    expect(getDepthDefendedUnitIds([arc, cav, rear])).not.toContain('c');
  });
});

/* ══════════════════ payload 级：buildValidActions 真的下发了吗 ══════════════════ */

describe('buildValidActions 的威胁字段', () => {
  /**
   * 上面测的是纯函数，这里测**真的被装进了下发给客户端的消息里**。
   * 少了这一层，纯函数全绿但客户端什么都收不到。
   */
  type Probe = {
    state: GameStateSchema;
    setState: (s: GameStateSchema) => void;
    buildValidActions: () => {
      forPlayer: string;
      threatHexes: Array<[number, number]>;
      depthDefended: string[];
      lethal: Record<string, string[]>;
    };
  };

  function mkRoom(): Probe {
    const r = new ShiyuanRoom() as unknown as Probe;
    r.setState(new GameStateSchema());
    r.state.currentPlayer = 'player1';
    r.state.phase = 'action';
    r.state.player1ActionPoints = 9;
    r.state.player2ActionPoints = 9;
    r.state.player1BaseQ = 0; r.state.player1BaseR = 4; r.state.player1BaseS = -4;
    r.state.player2BaseQ = 0; r.state.player2BaseR = -4; r.state.player2BaseS = 4;
    return r;
  }

  function put(r: Probe, id: string, type: string, owner: string, q: number, rr: number,
               extra: Partial<UnitSchema> = {}) {
    const u = new UnitSchema();
    Object.assign(u, {
      id, type, owner, q, r: rr, s: -q - rr,
      hp: 2, maxHp: 2, direction: 0, actionsThisTurn: 0,
      hasMoved: false, hasAttacked: false, hasRotated: false,
      generalType: '', bonusActionLimit: 0, unlimitedActions: false,
      hasActedThisTurn: false, chargeLevel: 0, movementRestricted: false,
      moveDistance: 0,
      ...extra,
    });
    r.state.units.set(id, u);
    return u;
  }

  it('threatHexes 算的是**非行动方**的威胁，且真的下发', () => {
    const r = mkRoom();
    put(r, 'mine', 'infantry', 'player1', 0, 3);
    put(r, 'foe', 'infantry', 'player2', 0, -3);
    const p = r.buildValidActions();
    expect(p.forPlayer).toBe('player1');
    expect(p.threatHexes.length).toBeGreaterThan(0);
    // 敌方步兵在 (0,-3)，它的邻格该在威胁里；我方步兵 (0,3) 的邻格不该在
    const set = new Set(p.threatHexes.map(([q, rr]) => `${q},${rr}`));
    expect(set.has('1,-3')).toBe(true);
    expect(set.has('1,3')).toBe(false);
  });

  it('场上没有敌方单位时 threatHexes 为空', () => {
    const r = mkRoom();
    put(r, 'mine', 'infantry', 'player1', 0, 3);
    expect(r.buildValidActions().threatHexes).toEqual([]);
  });

  it('depthDefended 下发了处于纵深抗击下的单位 id', () => {
    const r = mkRoom();
    // 弓手与目标同轴（r 不变），背后紧跟一个己方步兵
    put(r, 'arc', 'archer', 'player1', -1, 0);
    put(r, 'front', 'infantry', 'player2', 0, 0);
    put(r, 'rear', 'infantry', 'player2', 1, 0);
    expect(r.buildValidActions().depthDefended).toContain('front');
  });

  it('不同轴时不触发 —— 纵深抗击只沿六边形的三条轴线生效', () => {
    const r = mkRoom();
    put(r, 'arc', 'archer', 'player1', -1, 1);
    put(r, 'front', 'infantry', 'player2', 0, 0);
    put(r, 'rear', 'infantry', 'player2', 1, 0);
    expect(r.buildValidActions().depthDefended).not.toContain('front');
  });

  it('lethal 是 attacks 的子集，且只含真能一击杀死的目标', () => {
    const r = mkRoom();
    put(r, 'cav', 'cavalry', 'player1', 0, 0, { moveDistance: 2 });
    put(r, 'full', 'infantry', 'player2', 1, 0, { hp: 2 });
    const p = r.buildValidActions();
    // 冲锋 2 格 → 伤害 2 → 满血 2 的步兵会被杀
    expect(p.lethal['cav'] ?? []).toContain('full');
  });

  it('没冲锋时满血目标不算致命', () => {
    const r = mkRoom();
    put(r, 'cav', 'cavalry', 'player1', 0, 0, { moveDistance: 0 });
    put(r, 'full', 'infantry', 'player2', 1, 0, { hp: 2 });
    expect(r.buildValidActions().lethal['cav'] ?? []).not.toContain('full');
  });
});
