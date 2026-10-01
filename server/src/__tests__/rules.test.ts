import { beforeEach, describe, expect, it } from 'vitest';
import { ShiyuanRoom } from '../rooms/ShiyuanRoom';
import { GameStateSchema, UnitSchema } from '../schema/GameState';
import { getMachineOccupiedHexes, isInMapRange } from '../../../shared/utils/hexUtils';

/**
 * 服务端规则谓词的单元测试
 *
 * 这几个函数现在是全项目唯一的规则来源：客户端的高亮和服务端的校验都走它们
 * （以前客户端另有一份 2000 行实现，两边会漂移 —— 例如无双将军解除行动限制后
 * 客户端算不出可移动格）。所以它们值得被锁住。
 *
 * 测的是**生产代码本身**：直接 new ShiyuanRoom() 不起 transport 即可调用，
 * 不需要把逻辑复制成「可测版本」，也就不存在测试和线上跑的是两份代码的问题。
 */

/** 房间的私有方法需要绕过可见性访问 */
type RoomProbe = {
  state: GameStateSchema;
  setState: (s: GameStateSchema) => void;
  checkAttackLegality: (
    a: UnitSchema,
    t: UnitSchema
  ) => { ok: true; cost: number; archerBlocked: boolean } | { ok: false; reason: string };
  getAttackableTargets: (u: UnitSchema) => string[];
  getValidMoves: (u: UnitSchema) => { q: number; r: number; s: number; steps?: number }[];
  checkBallistaMeleeLegality: (b: UnitSchema, t: UnitSchema) => { ok: true } | { ok: false; reason: string };
  occupiedHexesOf: (u: UnitSchema) => { q: number; r: number; s: number }[];
};

let room: RoomProbe;

/** 造一个单位并放进 state */
function place(
  id: string,
  type: string,
  owner: string,
  q: number,
  r: number,
  extra: Partial<UnitSchema> = {}
): UnitSchema {
  const u = new UnitSchema();
  Object.assign(u, {
    id, type, owner, q, r, s: -q - r,
    hp: 1, maxHp: 1, direction: 0, actionsThisTurn: 0,
    hasMoved: false, hasAttacked: false, hasRotated: false,
    generalType: '', bonusActionLimit: 0, unlimitedActions: false,
    hasActedThisTurn: false, chargeLevel: 0, movementRestricted: false,
    ...extra,
  });
  room.state.units.set(id, u);
  return u;
}

const unit = (id: string) => room.state.units.get(id)!;

beforeEach(() => {
  room = new ShiyuanRoom() as unknown as RoomProbe;
  room.setState(new GameStateSchema());
  room.state.currentPlayer = 'player1';
  room.state.phase = 'action';
  // 大本营设在双方底线，供弓箭手射程（3 + 距己方基线距离）计算
  room.state.player1BaseQ = 0; room.state.player1BaseR = 4; room.state.player1BaseS = -4;
  room.state.player2BaseQ = 0; room.state.player2BaseR = -4; room.state.player2BaseS = 4;
});

describe('checkAttackLegality —— 近战单位', () => {
  it('相邻敌人可攻击，消耗 1 点', () => {
    const a = place('a', 'infantry', 'player1', 0, 0);
    const b = place('b', 'infantry', 'player2', 1, 0);
    const r = room.checkAttackLegality(a, b);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cost).toBe(1);
      expect(r.archerBlocked).toBe(false);
    }
  });

  it('距离 2 的敌人打不到', () => {
    const a = place('a', 'infantry', 'player1', 0, 0);
    const b = place('b', 'infantry', 'player2', 2, 0);
    const r = room.checkAttackLegality(a, b);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('目标不在攻击范围内');
  });

  it('攻击将领消耗 2 点', () => {
    const a = place('a', 'infantry', 'player1', 0, 0);
    const g = place('g', 'general', 'player2', 1, 0);
    const r = room.checkAttackLegality(a, g);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cost).toBe(2);
  });

  it('本回合已攻击过的非弓箭手不能再攻击', () => {
    const a = place('a', 'infantry', 'player1', 0, 0, { hasAttacked: true });
    const b = place('b', 'infantry', 'player2', 1, 0);
    const r = room.checkAttackLegality(a, b);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('该单位本回合已攻击过');
  });

  it('骑兵、将领同样按相邻判定', () => {
    for (const t of ['cavalry', 'general']) {
      room.setState(new GameStateSchema());
      room.state.player1BaseR = 4; room.state.player2BaseR = -4;
      const a = place('a', t, 'player1', 0, 0);
      const near = place('near', 'infantry', 'player2', 1, 0);
      const far = place('far', 'infantry', 'player2', 2, 0);
      expect(room.checkAttackLegality(a, near).ok, t).toBe(true);
      expect(room.checkAttackLegality(a, far).ok, t).toBe(false);
    }
  });
});

describe('checkAttackLegality —— 弓箭手', () => {
  it('射程是 3 + 距己方基线距离，超出则拒绝', () => {
    // getDistanceToBaseline 对 top 方是 max(0, 5 - r)，最后一排 r=5 才是距离 0。
    // 放在 r=5 → 射程 3 + 0 = 3
    const a = place('a', 'archer', 'player1', 0, 5);
    const inRange = place('in', 'infantry', 'player2', 0, 2);   // 距离 3
    const outRange = place('out', 'infantry', 'player2', 0, 1); // 距离 4
    expect(room.checkAttackLegality(a, inRange).ok).toBe(true);
    expect(room.checkAttackLegality(a, outRange).ok).toBe(false);
  });

  it('越靠前射程越远（基线距离加成）', () => {
    // r=2 → 基线距离 3 → 射程 6
    const a = place('a', 'archer', 'player1', 0, 2);
    const at6 = place('t6', 'infantry', 'player2', 0, -4); // 距离 6，刚好够
    expect(room.checkAttackLegality(a, at6).ok).toBe(true);

    // 同一个目标，如果弓箭手退到基线（射程 3）就打不到了
    const back = place('back', 'archer', 'player1', 1, 5);
    expect(room.checkAttackLegality(back, at6).ok).toBe(false);
  });

  it('弓箭手每回合可行动 2 次，达到上限后拒绝', () => {
    const a = place('a', 'archer', 'player1', 0, 4, { actionsThisTurn: 2 });
    const t = place('t', 'infantry', 'player2', 0, 2);
    const r = room.checkAttackLegality(a, t);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('该单位本回合已达行动次数上限');
  });

  it('弓箭手已攻击过但未达行动上限，仍可再攻击', () => {
    // 这是弓箭手与其他兵种的区别：不看 hasAttacked，只看行动次数
    const a = place('a', 'archer', 'player1', 0, 4, { hasAttacked: true, actionsThisTurn: 1 });
    const t = place('t', 'infantry', 'player2', 0, 2);
    expect(room.checkAttackLegality(a, t).ok).toBe(true);
  });

  it('射击路径经过友军时报告 archerBlocked 并额外消耗 1 点', () => {
    const a = place('a', 'archer', 'player1', 0, 4);
    place('friend', 'infantry', 'player1', 0, 3); // 挡在路径中间
    const t = place('t', 'infantry', 'player2', 0, 2);
    const r = room.checkAttackLegality(a, t);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.archerBlocked).toBe(true);
      expect(r.cost).toBe(2); // 普通目标 1 + 阻挡 1
    }
  });

  it('路径无友军时不额外消耗', () => {
    const a = place('a', 'archer', 'player1', 0, 4);
    const t = place('t', 'infantry', 'player2', 0, 2);
    const r = room.checkAttackLegality(a, t);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.archerBlocked).toBe(false);
      expect(r.cost).toBe(1);
    }
  });

  it('谓词本身不产生副作用（不写战报）', () => {
    const a = place('a', 'archer', 'player1', 0, 4);
    place('friend', 'infantry', 'player1', 0, 3);
    const t = place('t', 'infantry', 'player2', 0, 2);
    const before = room.state.battleLog.length;
    room.checkAttackLegality(a, t);
    room.checkAttackLegality(a, t);
    // 算高亮时会被调用很多次，一旦写日志就会刷屏
    expect(room.state.battleLog.length).toBe(before);
  });
});

describe('checkAttackLegality —— 机关单位的体积', () => {
  it('按体积间最小距离判定，而不是中心点距离', () => {
    // 战车占 4 格（中心 + 右上/右/右下），所以中心距 2 也可能相邻
    const a = place('a', 'infantry', 'player1', 2, 0);
    const chariot = place('c', 'chariot', 'player2', 0, 0);
    const centerDist = 2;
    expect(centerDist).toBe(2);
    // 战车体积包含 (1,0)，与 (2,0) 相邻 → 可攻击
    expect(room.checkAttackLegality(a, chariot).ok).toBe(true);
  });

  it('投石车每回合行动上限 2 次', () => {
    const cat = place('cat', 'catapult', 'player1', 0, 0, { actionsThisTurn: 2 });
    const t = place('t', 'infantry', 'player2', 1, 0);
    const r = room.checkAttackLegality(cat, t);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('投石车本回合已达行动次数上限');
  });
});

describe('机关单位的攻击范围（曾经完全没有服务端限制）', () => {
  // 这一组对应一个真实漏洞：checkAttackLegality 原来只对
  // infantry/cavalry/general（相邻）和 archer（射程）做判定，
  // 机关类落进「没有任何射程判定」的分支 —— 投石车可以隔着整张图打对角。
  // 范围规则此前只存在于客户端的高亮计算里。

  it('投石车只能打朝向直线上的目标', () => {
    // direction 0 = EAST
    const cat = place('cat', 'catapult', 'player1', -2, 0, { direction: 0 });
    const east = place('east', 'infantry', 'player2', 1, 0);
    const notOnLine = place('nl', 'infantry', 'player2', -2, -3);
    expect(room.checkAttackLegality(cat, east).ok).toBe(true);
    const r = room.checkAttackLegality(cat, notOnLine);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('目标不在投石车射击方向上');
  });

  it('投石车不能打整张图对角的目标', () => {
    const cat = place('cat', 'catapult', 'player1', 0, 5, { direction: 0 });
    const far = place('far', 'infantry', 'player2', 0, -5);
    expect(room.checkAttackLegality(cat, far).ok).toBe(false);
  });

  it('战车没有攻击动作', () => {
    const ch = place('ch', 'chariot', 'player1', 0, 0);
    const foe = place('foe', 'infantry', 'player2', 1, 0);
    const r = room.checkAttackLegality(ch, foe);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('战车没有攻击动作');
  });

  it('弩车不走普通攻击路径（它有贯穿/近战专用指令）', () => {
    const bal = place('bal', 'ballista', 'player1', 0, 0);
    const foe = place('foe', 'infantry', 'player2', 1, 0);
    const r = room.checkAttackLegality(bal, foe);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('弩车请使用贯穿或近战攻击');
  });
});

describe('checkBallistaMeleeLegality', () => {
  // handleBallistaMeleeAttack 原来扣完行动点就直接 target.hp -= 1，
  // 没有相邻判定也没有敌我判定 —— 弩车可以近战全图任何单位。

  it('相邻敌人可近战', () => {
    const bal = place('bal', 'ballista', 'player1', 0, 4);
    const near = place('near', 'infantry', 'player2', 1, 4);
    expect(room.checkBallistaMeleeLegality(bal, near).ok).toBe(true);
  });

  it('远处敌人不可近战', () => {
    const bal = place('bal', 'ballista', 'player1', 0, 4);
    const far = place('far', 'infantry', 'player2', 0, -5);
    const r = room.checkBallistaMeleeLegality(bal, far);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('目标不在弩车近战范围内');
  });

  it('不能近战友军', () => {
    const bal = place('bal', 'ballista', 'player1', 0, 4);
    const friend = place('f', 'infantry', 'player1', 1, 4);
    const r = room.checkBallistaMeleeLegality(bal, friend);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('不能攻击友军');
  });

  it('本回合已行动则不可近战', () => {
    const bal = place('bal', 'ballista', 'player1', 0, 4, { hasActedThisTurn: true });
    const near = place('near', 'infantry', 'player2', 1, 4);
    const r = room.checkBallistaMeleeLegality(bal, near);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('弩车本回合已行动');
  });

  it('按体积相邻判定：弩车占 3 格，贴着车身任一格即可', () => {
    const bal = place('bal', 'ballista', 'player1', 0, 2);
    // 弩车(player1)车身含中心 + 东南/西南两格，贴着车身而非中心的目标也该可打
    const body = room.occupiedHexesOf(bal);
    expect(body.length).toBe(3);
    const rear = body.find(h => h.r !== bal.r)!;
    const beside = place('beside', 'infantry', 'player2', rear.q + 1, rear.r);
    expect(room.checkBallistaMeleeLegality(bal, beside).ok).toBe(true);
  });

  it('getAttackableTargets 对弩车只列近战范围内的目标', () => {
    const bal = place('bal', 'ballista', 'player1', 0, 4);
    place('near', 'infantry', 'player2', 1, 4);
    place('far', 'infantry', 'player2', 0, -5);
    expect(room.getAttackableTargets(bal)).toEqual(['near']);
  });
});

describe('getAttackableTargets', () => {
  it('列出所有相邻敌人，排除自己与友军', () => {
    const a = place('a', 'infantry', 'player1', 0, 0);
    place('foe1', 'infantry', 'player2', 1, 0);
    place('foe2', 'infantry', 'player2', 0, 1);
    place('friend', 'infantry', 'player1', -1, 0);
    place('farFoe', 'infantry', 'player2', 3, 0);
    expect(room.getAttackableTargets(a).sort()).toEqual(['foe1', 'foe2']);
  });

  it('包含中立单位 —— 必须与 handleAttackUnit 的接受范围一致', () => {
    // handleAttackUnit 并不拒绝攻击中立单位；这里若排除中立，
    // 就会造出「服务端允许但界面不高亮」的新分歧。
    const a = place('a', 'infantry', 'player1', 0, 0);
    place('neu', 'neutral_marker', 'neutral', 1, 0);
    expect(room.getAttackableTargets(a)).toContain('neu');
  });

  it('不能攻击时返回空数组', () => {
    const a = place('a', 'infantry', 'player1', 0, 0, { hasAttacked: true });
    place('foe', 'infantry', 'player2', 1, 0);
    expect(room.getAttackableTargets(a)).toEqual([]);
  });
});

describe('战报措辞', () => {
  // 战报现在直接显示给玩家（以前服务端这份根本没同步下去，客户端另画一份自己猜的），
  // 所以不该出现 player1 / infantry 这类内部标识符。

  const logOf = (raw: string) => {
    const before = room.state.battleLog.length;
    (room as unknown as { addBattleLog: (m: string) => void }).addBattleLog(raw);
    return room.state.battleLog[before];
  };

  it('把阵营和兵种标识符换成中文', () => {
    expect(logOf('player1移动infantry到(1,1,-2)')).toBe('玩家1移动步兵到(1,1,-2)');
    expect(logOf('player1的archer攻击了player2的infantry')).toBe('玩家1的弓箭手攻击了玩家2的步兵');
    expect(logOf('player2的catapult蓄力成功')).toBe('玩家2的投石车蓄力成功');
    expect(logOf('player1的ballista贯穿击杀了player2的chariot'))
      .toBe('玩家1的弩车贯穿击杀了玩家2的战车');
  });

  it('neutral_marker 不会被 neutral 规则切坏', () => {
    expect(logOf('击杀neutral_marker')).toBe('击杀中立标记');
    expect(logOf('neutral的huangjin_lishi')).toBe('中立的黄巾力士');
  });

  it('已经是中文的文本原样保留', () => {
    expect(logOf('玩家1骰子数为0，游戏结束！')).toBe('玩家1骰子数为0，游戏结束！');
  });

  it('战报只保留最近 20 条', () => {
    for (let i = 0; i < 30; i++) logOf(`第${i}条`);
    expect(room.state.battleLog.length).toBeLessThanOrEqual(20);
  });
});

describe('getValidMoves', () => {
  it('普通步兵可走相邻空格', () => {
    const a = place('a', 'infantry', 'player1', 0, 0);
    const moves = room.getValidMoves(a);
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) {
      expect(m.q + m.r + m.s).toBe(0);
    }
  });

  it('已达行动次数上限时不能移动', () => {
    const a = place('a', 'infantry', 'player1', 0, 0, { actionsThisTurn: 2 });
    expect(room.getValidMoves(a)).toEqual([]);
  });

  it('本回合已移动过就不能再移动', () => {
    const a = place('a', 'infantry', 'player1', 0, 0, { hasMoved: true });
    expect(room.getValidMoves(a)).toEqual([]);
  });

  it('无双将军的 unlimitedActions 能解除「移动过就不能再动」的限制', () => {
    // 这正是客户端旧实现漏掉的判断：它不看 unlimitedActions，
    // 于是无双将军用掉技能后客户端算出 0 个落点，玩家以为技能没生效。
    const g = place('g', 'general', 'player1', 0, 0, {
      generalType: 'wushuang', hasMoved: true, unlimitedActions: true, actionsThisTurn: 1,
    });
    expect(room.getValidMoves(g).length).toBeGreaterThan(0);
  });

  it('没有 unlimitedActions 的将军移动过后不能再动（对照组）', () => {
    const g = place('g', 'general', 'player1', 0, 0, {
      generalType: 'wushuang', hasMoved: true, unlimitedActions: false, actionsThisTurn: 1,
    });
    expect(room.getValidMoves(g)).toEqual([]);
  });

  it('bonusActionLimit 提高行动次数上限', () => {
    const withBonus = place('g1', 'general', 'player1', 0, 0, {
      generalType: 'wushuang', actionsThisTurn: 2, bonusActionLimit: 2,
    });
    expect(room.getValidMoves(withBonus).length).toBeGreaterThan(0);

    const noBonus = place('g2', 'general', 'player1', 3, 0, {
      generalType: 'wushuang', actionsThisTurn: 2, bonusActionLimit: 0,
    });
    expect(room.getValidMoves(noBonus)).toEqual([]);
  });

  it('落点不会与其他单位重叠', () => {
    const a = place('a', 'infantry', 'player1', 0, 0);
    place('block', 'infantry', 'player2', 1, 0);
    const moves = room.getValidMoves(a);
    expect(moves.some(m => m.q === 1 && m.r === 0)).toBe(false);
  });

  it.each(['ballista', 'catapult', 'chariot'])(
    '%s 的落点不会让车身伸出棋盘',
    (type) => {
      // 机关占多格。原来只有战车检查整个车身，弩车和投石车只查（或漏查）中心格，
      // 结果有落点让车身有一格伸到棋盘外 —— 那一格既画不出来也打不到。
      for (let q = -5; q <= 5; q++) {
        for (let r = Math.max(-5, -q - 5); r <= Math.min(5, -q + 5); r++) {
          room.setState(new GameStateSchema());
          const u = place('m', type, 'player1', q, r);
          for (const m of room.getValidMoves(u)) {
            const body = getMachineOccupiedHexes(
              { q: m.q, r: m.r, s: m.s },
              type as 'ballista' | 'chariot' | 'catapult',
              true
            );
            for (const h of body) {
              expect(isInMapRange(h, 5), `${type}@(${q},${r}) -> (${m.q},${m.r}) 车身 (${h.q},${h.r})`).toBe(true);
            }
          }
        }
      }
    }
  );

  it('落点全部在地图范围内', () => {
    const a = place('a', 'infantry', 'player1', 5, -5);
    for (const m of room.getValidMoves(a)) {
      expect(Math.abs(m.q)).toBeLessThanOrEqual(5);
      expect(Math.abs(m.r)).toBeLessThanOrEqual(5);
      expect(Math.abs(m.s)).toBeLessThanOrEqual(5);
    }
  });

  it('骑兵的落点带步数信息', () => {
    const c = place('c', 'cavalry', 'player1', 0, 0);
    const moves = room.getValidMoves(c);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.some(m => (m.steps ?? 1) > 1)).toBe(true);
  });
});
