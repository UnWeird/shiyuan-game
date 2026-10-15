import { beforeEach, describe, expect, it } from 'vitest';
import { ShiyuanRoom } from '../rooms/ShiyuanRoom';
import { GameStateSchema, UnitSchema } from '../schema/GameState';
import {
  CIVILIAN_TAG,
  checkAttackLegality,
  getAttackableTargets,
  getValidMoves,
  type UnitLike,
} from '../../../shared/rules/queries';

/**
 * 太平 · 平民在战场上的交互
 *
 * 分两层：
 *   - 代价与合法性（纯函数）：攻击平民 +1 AP、太平阵营打不了平民、
 *     平民挡在弓箭手路径上折成 +1 AP
 *   - 死亡的连带效果（房间）：不给士气、扣太平天命（每轮上限 2）、
 *     不重置仁德招降费用
 */

type RoomProbe = {
  state: GameStateSchema;
  setState: (s: GameStateSchema) => void;
  rng: () => number;
  unitList: UnitLike[];
  killUnit: (u: UnitSchema) => void;
  grantFirstKillReward: (role: 'player1' | 'player2', victim: UnitSchema, label?: string) => boolean;
  handleAttackUnit: (c: unknown, d: { attackerId: string; targetId: string }) => void;
  handleRendeCompleteKill: (c: unknown, d: { targetId: string }) => void;
  handleEndTurn: (c: unknown) => void;
  getPlayerRole: (c: unknown) => 'player1' | 'player2' | null;
};

let room: RoomProbe;
const errors: string[] = [];

/** 假 client：把服务端回的 error 收集起来 */
const client = (role: 'player1' | 'player2') => ({
  sessionId: role,
  send: (type: string, data: { message?: string }) => {
    if (type === 'error') errors.push(data.message ?? '');
  },
});

function newGame(p1 = 'taiping', p2 = 'wushuang'): RoomProbe {
  const r = new ShiyuanRoom() as unknown as RoomProbe;
  r.setState(new GameStateSchema());
  r.state.phase = 'action';
  r.state.currentPlayer = 'player1';
  r.state.player1General = p1;
  r.state.player2General = p2;
  r.state.player1ActionPoints = 20;
  r.state.player2ActionPoints = 20;
  r.state.player1BaseQ = 0; r.state.player1BaseR = 5; r.state.player1BaseS = -5;
  r.state.player2BaseQ = 0; r.state.player2BaseR = -5; r.state.player2BaseS = 5;
  r.getPlayerRole = (c: unknown) => (c as { sessionId: string }).sessionId as 'player1' | 'player2';
  return r;
}

function place(id: string, type: string, owner: string, q: number, r: number, extra: Partial<UnitSchema> = {}) {
  const u = new UnitSchema();
  u.id = id;
  u.type = type;
  u.owner = owner;
  u.q = q; u.r = r; u.s = -q - r;
  u.hp = 2; u.maxHp = 2;
  Object.assign(u, extra);
  room.state.units.set(id, u);
  return u;
}

const civ = (id: string, q: number, r: number) =>
  place(id, 'neutral_marker', 'neutral', q, r, { hp: 1, maxHp: 1, statusTag: CIVILIAN_TAG });

/** 仁德「以德服人」留下的中立标记：同类型但没有 civilian 标记 */
const rendeNeutral = (id: string, q: number, r: number) =>
  place(id, 'neutral_marker', 'neutral', q, r, { hp: 1, maxHp: 1 });

const taiping = (role: 'player1' | 'player2', q = 0, r = 4) =>
  place(`g_${role}`, 'general', role, q, r, { generalType: 'taiping', hp: 3, maxHp: 3 });

const U = (u: UnitSchema) => u as unknown as UnitLike;

beforeEach(() => {
  errors.length = 0;
  room = newGame();
});

describe('攻击平民的代价', () => {
  it('普通单位主动攻击平民要 2 点（基础 1 + 平民 1）', () => {
    const a = place('a', 'infantry', 'player2', 0, 0);
    const c = civ('c1', 1, 0);
    const res = checkAttackLegality(U(a), U(c), room.unitList);
    expect(res.ok).toBe(true);
    expect((res as { cost: number }).cost).toBe(2);
  });

  it('打普通敌方单位仍是 1 点，打将领仍是 2 点', () => {
    const a = place('a', 'infantry', 'player2', 0, 0);
    const foe = place('f', 'infantry', 'player1', 1, 0);
    const gen = place('g', 'general', 'player1', 0, 1, { generalType: 'wushuang', hp: 4, maxHp: 4 });
    expect((checkAttackLegality(U(a), U(foe), room.unitList) as { cost: number }).cost).toBe(1);
    expect((checkAttackLegality(U(a), U(gen), room.unitList) as { cost: number }).cost).toBe(2);
  });

  it('弓箭手隔着平民打敌人：+1 点，但攻击不被阻止', () => {
    const archer = place('ar', 'archer', 'player2', 0, -2);
    civ('c1', 0, -1);
    const foe = place('f', 'infantry', 'player1', 0, 0);
    const res = checkAttackLegality(U(archer), U(foe), room.unitList);
    expect(res.ok).toBe(true);
    expect((res as { cost: number; archerBlocked: boolean }).cost).toBe(2);
    expect((res as { archerBlocked: boolean }).archerBlocked).toBe(true);
  });

  it('弓箭手隔着平民打平民：1 + 平民 1 + 阻挡 1 = 3 点', () => {
    const archer = place('ar', 'archer', 'player2', 0, -2);
    civ('mid', 0, -1);
    const far = civ('far', 0, 0);
    expect((checkAttackLegality(U(archer), U(far), room.unitList) as { cost: number }).cost).toBe(3);
  });

  it('仁德自造的中立标记不算平民，不加价也不挡路', () => {
    const a = place('a', 'infantry', 'player2', 0, 0);
    const n = rendeNeutral('n1', 1, 0);
    expect((checkAttackLegality(U(a), U(n), room.unitList) as { cost: number }).cost).toBe(1);

    const archer = place('ar', 'archer', 'player2', 0, -2);
    rendeNeutral('mid', 0, -1);
    const foe = place('f', 'infantry', 'player1', 0, 0);
    expect((checkAttackLegality(U(archer), U(foe), room.unitList) as { cost: number }).cost).toBe(1);
  });
});

describe('太平阵营不能主动攻击平民', () => {
  it('太平存活时，己方步兵打不到平民', () => {
    taiping('player1');
    const inf = place('i', 'infantry', 'player1', 0, 0);
    const c = civ('c1', 1, 0);
    const res = checkAttackLegality(U(inf), U(c), room.unitList);
    expect(res.ok).toBe(false);
    expect(getAttackableTargets(U(inf), room.unitList)).not.toContain('c1');
  });

  it('太平本人也打不到平民', () => {
    const g = taiping('player1', 0, 0);
    civ('c1', 1, 0);
    expect(getAttackableTargets(U(g), room.unitList)).not.toContain('c1');
  });

  it('太平死后，该方正规军可以打平民了', () => {
    // 不放太平将军单位 = 已阵亡
    const inf = place('i', 'infantry', 'player1', 0, 0);
    const c = civ('c1', 1, 0);
    expect(checkAttackLegality(U(inf), U(c), room.unitList).ok).toBe(true);
    expect(getAttackableTargets(U(inf), room.unitList)).toContain('c1');
  });

  it('对手不受此限制，始终可以打平民', () => {
    taiping('player1');
    const foe = place('f', 'infantry', 'player2', 0, 0);
    civ('c1', 1, 0);
    expect(getAttackableTargets(U(foe), room.unitList)).toContain('c1');
  });

  it('双太平：约束只看攻击方自己那侧的太平是否存活', () => {
    room = newGame('taiping', 'taiping');
    taiping('player2', 0, -4);             // player2 的太平活着
    const p1inf = place('i1', 'infantry', 'player1', 0, 0);  // player1 的太平已阵亡
    const p2inf = place('i2', 'infantry', 'player2', 0, 1);
    const c = civ('c1', 1, 0);

    // player1 的太平没了 → 它的步兵可以打平民
    expect(checkAttackLegality(U(p1inf), U(c), room.unitList).ok).toBe(true);
    // player2 的太平还在 → 它的步兵不能打
    expect(checkAttackLegality(U(p2inf), U(c), room.unitList).ok).toBe(false);
  });
});

describe('平民占格', () => {
  it('平民阻挡移动', () => {
    const inf = place('i', 'infantry', 'player2', 0, 0);
    civ('c1', 1, 0);
    const moves = getValidMoves(U(inf), room.unitList);
    expect(moves.some(m => m.q === 1 && m.r === 0)).toBe(false);
    expect(moves.length).toBe(5); // 六个邻格里有一个被占
  });

  it('骑兵不能穿过平民', () => {
    const cav = place('cv', 'cavalry', 'player2', 0, 0);
    // (3,0) 距离正好 3，骑兵满移动恰好够到，但唯一路线必须经过 (1,0) 和 (2,0)
    const before = getValidMoves(U(cav), room.unitList);
    expect(before.some(m => m.q === 3 && m.r === 0)).toBe(true);

    civ('c1', 1, 0);
    const after = getValidMoves(U(cav), room.unitList);
    expect(after.some(m => m.q === 1 && m.r === 0)).toBe(false);
    expect(after.some(m => m.q === 3 && m.r === 0)).toBe(false);
  });
});

describe('击杀平民的连带效果', () => {
  it('不给士气奖励（不触发首杀骰）', () => {
    taiping('player1');
    const c = civ('c1', 1, 0);
    const before = room.state.player2ActionPoints;
    expect(room.grantFirstKillReward('player2', c)).toBe(false);
    expect(room.state.player2KilledThisTurn).toBe(false);
    expect(room.state.player2ActionPoints).toBe(before);
  });

  it('击杀普通单位照常给士气奖励（没被我改坏）', () => {
    const foe = place('f', 'infantry', 'player1', 1, 0);
    room.rng = () => 0.5; // rollD6 → 4
    expect(room.grantFirstKillReward('player2', foe)).toBe(true);
    expect(room.state.player2KilledThisTurn).toBe(true);
    expect(room.state.player2ActionPoints).toBe(24);
  });

  it('平民死亡：存活的太平失去 1 点天命', () => {
    taiping('player1');
    room.state.player1Taiping.destiny = 7;
    room.killUnit(civ('c1', 1, 0));
    expect(room.state.player1Taiping.destiny).toBe(6);
    expect(room.state.units.has('c1')).toBe(false);
  });

  it('每个完整轮次最多失去 2 点', () => {
    taiping('player1');
    room.state.player1Taiping.destiny = 9;
    room.killUnit(civ('c1', 1, 0));
    room.killUnit(civ('c2', 2, 0));
    room.killUnit(civ('c3', 3, 0));
    room.killUnit(civ('c4', -1, 0));
    expect(room.state.player1Taiping.destiny).toBe(7);
    expect(room.state.player1Taiping.destinyLostThisRound).toBe(2);
  });

  it('天命已见底时扣不动，也不占用本轮额度', () => {
    taiping('player1');
    room.state.player1Taiping.destiny = 0;
    room.killUnit(civ('c1', 1, 0));
    room.killUnit(civ('c2', 2, 0));
    expect(room.state.player1Taiping.destiny).toBe(0);
    expect(room.state.player1Taiping.destinyLostThisRound).toBe(0);

    // 天命涨回来后仍有完整的 2 点额度
    room.state.player1Taiping.destiny = 5;
    room.killUnit(civ('c3', 3, 0));
    room.killUnit(civ('c4', -1, 0));
    expect(room.state.player1Taiping.destiny).toBe(3);
  });

  it('太平已阵亡的一方不扣天命', () => {
    room.state.player1Taiping.destiny = 7; // 但场上没有太平将军
    room.killUnit(civ('c1', 1, 0));
    expect(room.state.player1Taiping.destiny).toBe(7);
  });

  it('双太平：两名存活的太平各失去 1 点', () => {
    room = newGame('taiping', 'taiping');
    taiping('player1', 0, 4);
    taiping('player2', 0, -4);
    room.state.player1Taiping.destiny = 8;
    room.state.player2Taiping.destiny = 3;
    room.killUnit(civ('c1', 1, 0));
    expect(room.state.player1Taiping.destiny).toBe(7);
    expect(room.state.player2Taiping.destiny).toBe(2);
  });

  it('双太平中一方已阵亡时，只有存活那方扣天命', () => {
    room = newGame('taiping', 'taiping');
    taiping('player1', 0, 4); // player2 的太平不在场
    room.state.player1Taiping.destiny = 8;
    room.state.player2Taiping.destiny = 8;
    room.killUnit(civ('c1', 1, 0));
    expect(room.state.player1Taiping.destiny).toBe(7);
    expect(room.state.player2Taiping.destiny).toBe(8);
  });

  it('力士转平民不算平民死亡（走转化路径，不经过 killUnit）', () => {
    // 这里只锁住「扣天命的唯一入口是 killUnit」：
    // 直接 delete 不会触发扣减，步骤 6 的转化正是这么做的
    taiping('player1');
    room.state.player1Taiping.destiny = 7;
    const c = civ('c1', 1, 0);
    room.state.units.delete(c.id);
    expect(room.state.player1Taiping.destiny).toBe(7);
  });

  it('新的完整轮次会重置扣天命额度', () => {
    taiping('player1');
    room.state.player1Taiping.destiny = 9;
    room.killUnit(civ('c1', 1, 0));
    room.killUnit(civ('c2', 2, 0));
    expect(room.state.player1Taiping.destinyLostThisRound).toBe(2);

    // player1 结束 → player2 结束 → turn++，额度重置
    room.state.currentPlayer = 'player1';
    room.handleEndTurn(client('player1'));
    room.handleEndTurn(client('player2'));
    expect(room.state.turn).toBe(2);
    expect(room.state.player1Taiping.destinyLostThisRound).toBe(0);
  });
});

describe('与仁德的隔离', () => {
  it('击杀公共平民不重置仁德的招降费用', () => {
    // 必须走 handleAttackUnit：重置逻辑在那里，不在 killUnit 里
    // —— 直接调 killUnit 的话这条规则根本没被执行到，测试会变成空转。
    //
    // 而且重置的对象是**对手**的仁德（「中立单位被对方击杀时，你的费用重置」），
    // 所以仁德必须是被击杀方那一侧，否则这条分支同样不会被走到。
    room = newGame('rende', 'wushuang');
    const rende = place('gr', 'general', 'player1', 0, 4, {
      generalType: 'rende', hp: 4, maxHp: 4, convertInfantryCost: 8,
    });
    const c = civ('c1', 1, 0);
    const a = place('a', 'infantry', 'player2', 0, 0);
    room.state.currentPlayer = 'player2';

    room.handleAttackUnit(client('player2'), { attackerId: a.id, targetId: c.id });

    expect(errors).toEqual([]);
    expect(room.state.units.has('c1')).toBe(false);
    expect(rende.convertInfantryCost).toBe(8);
  });

  it('仁德确认击杀路径上，公共平民同样不重置费用', () => {
    room = newGame('taiping', 'rende');
    taiping('player1');
    const rende = place('gr', 'general', 'player2', 0, -4, {
      generalType: 'rende', hp: 4, maxHp: 4, convertInfantryCost: 4,
    });
    const c = civ('c1', 1, 0);
    room.state.currentPlayer = 'player2';

    room.handleRendeCompleteKill(client('player2'), { targetId: c.id });

    expect(room.state.units.has('c1')).toBe(false);
    expect(rende.convertInfantryCost).toBe(4);
  });

  it('击杀仁德自造的中立标记仍然重置费用（原规则没被改坏）', () => {
    room = newGame('wushuang', 'rende');
    const rende = place('gr', 'general', 'player2', 0, -4, {
      generalType: 'rende', hp: 4, maxHp: 4, convertInfantryCost: 8,
    });
    const n = rendeNeutral('n1', 1, 0);
    const a = place('a', 'infantry', 'player1', 0, 0);
    room.state.currentPlayer = 'player1';
    room.handleAttackUnit(client('player1'), { attackerId: a.id, targetId: n.id });
    expect(errors).toEqual([]);
    expect(room.state.units.has('n1')).toBe(false);
    expect(rende.convertInfantryCost).toBe(1);
  });

  it('端到端：对手一刀砍死平民 —— 扣 2 点 AP、太平掉天命、不给士气', () => {
    taiping('player1');
    const c = civ('c1', 1, 0);
    const a = place('a', 'infantry', 'player2', 0, 0);
    room.state.player1Taiping.destiny = 7;
    room.state.currentPlayer = 'player2';
    room.state.player2ActionPoints = 5;

    room.handleAttackUnit(client('player2'), { attackerId: a.id, targetId: c.id });

    expect(errors).toEqual([]);
    expect(room.state.units.has('c1')).toBe(false);
    expect(room.state.player2ActionPoints).toBe(3);      // 5 - 2，且没有士气骰加回来
    expect(room.state.player2KilledThisTurn).toBe(false);
    expect(room.state.player1Taiping.destiny).toBe(6);
  });

  it('端到端：太平阵营的步兵攻击平民被服务端拒绝', () => {
    taiping('player1');
    const c = civ('c1', 1, 0);
    const a = place('a', 'infantry', 'player1', 0, 0);
    room.state.currentPlayer = 'player1';

    room.handleAttackUnit(client('player1'), { attackerId: a.id, targetId: c.id });

    expect(errors).toEqual(['太平阵营不能攻击平民']);
    expect(room.state.units.has('c1')).toBe(true);
  });
});
