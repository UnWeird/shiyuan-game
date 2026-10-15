import { beforeEach, describe, expect, it } from 'vitest';
import { ShiyuanRoom } from '../rooms/ShiyuanRoom';
import { GameStateSchema, UnitSchema } from '../schema/GameState';
import {
  CIVILIAN_TAG,
  FUSHUI_COST,
  getFushuiTargets,
  type UnitLike,
} from '../../../shared/rules/queries';

/**
 * 太平 · 符水粥
 *
 * 2 AP 把一名相邻平民带离战场，换 1 点天命。
 * 最容易写错的两处：
 *   - 救济不是击杀，不能触发「平民死亡扣天命」（一加一减等于白做）
 *   - 它算作本回合的攻击类行动，和普通攻击**双向互斥**
 */

type RoomProbe = {
  state: GameStateSchema;
  setState: (s: GameStateSchema) => void;
  rng: () => number;
  unitList: UnitLike[];
  handleTaipingFushui: (c: unknown, d: { civilianId: string }) => void;
  handleAttackUnit: (c: unknown, d: { attackerId: string; targetId: string }) => void;
  handleMoveUnit: (c: unknown, d: { unitId: string; toQ: number; toR: number; toS: number }) => void;
  rollDiceForPlayer: (role: 'player1' | 'player2') => void;
  buildValidActions: () => { fushuiTargets: string[] };
  getPlayerRole: (c: unknown) => 'player1' | 'player2' | null;
};

let room: RoomProbe;
const errors: string[] = [];

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
  r.state.player1ActionPoints = 10;
  r.state.player2ActionPoints = 10;
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

const rendeNeutral = (id: string, q: number, r: number) =>
  place(id, 'neutral_marker', 'neutral', q, r, { hp: 1, maxHp: 1 });

/** 太平放在交战区中央，周围空着方便摆平民 */
const taiping = (role: 'player1' | 'player2' = 'player1', q = 0, r = 0) =>
  place(`g_${role}`, 'general', role, q, r, { generalType: 'taiping', hp: 3, maxHp: 3 });

const U = (u: UnitSchema) => u as unknown as UnitLike;

beforeEach(() => {
  errors.length = 0;
  room = newGame();
});

describe('可救济目标（纯函数）', () => {
  it('只含相邻的公共平民：距离 2 就已经救不到了', () => {
    const g = taiping();
    civ('d1', 1, 0);
    civ('d2', 2, 0);   // 正好 2 格 —— 和豆饭的 2 格范围区分开
    civ('d3', 3, 0);
    expect(getFushuiTargets(U(g), room.unitList, false)).toEqual(['d1']);
  });

  it('仁德自造的中立标记不是救济目标', () => {
    const g = taiping();
    rendeNeutral('n1', 1, 0);
    expect(getFushuiTargets(U(g), room.unitList, false)).toEqual([]);
  });

  it('六个方向的相邻平民都算', () => {
    const g = taiping();
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const dirs: Array<[number, number]> = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    dirs.forEach(([q, r], i) => civ(ids[i]!, q, r));
    expect(getFushuiTargets(U(g), room.unitList, false).sort()).toEqual(ids);
  });

  it('本回合已用过 → 没有目标', () => {
    const g = taiping();
    civ('c1', 1, 0);
    expect(getFushuiTargets(U(g), room.unitList, true)).toEqual([]);
  });

  it('本回合已攻击过 → 没有目标（和普通攻击互斥）', () => {
    const g = taiping();
    g.hasAttacked = true;
    civ('c1', 1, 0);
    expect(getFushuiTargets(U(g), room.unitList, false)).toEqual([]);
  });

  it('行动次数已满 → 没有目标', () => {
    const g = taiping();
    g.actionsThisTurn = 2;
    civ('c1', 1, 0);
    expect(getFushuiTargets(U(g), room.unitList, false)).toEqual([]);

    g.actionsThisTurn = 1; // 还剩一次
    expect(getFushuiTargets(U(g), room.unitList, false)).toEqual(['c1']);
  });

  it('非太平将领没有符水粥', () => {
    const g = place('gw', 'general', 'player1', 0, 0, { generalType: 'wushuang', hp: 4, maxHp: 4 });
    civ('c1', 1, 0);
    expect(getFushuiTargets(U(g), room.unitList, false)).toEqual([]);
  });

  it('不检查行动点 —— 够不够付是结算层的事', () => {
    const g = taiping();
    civ('c1', 1, 0);
    room.state.player1ActionPoints = 0;
    expect(getFushuiTargets(U(g), room.unitList, false)).toEqual(['c1']);
  });
});

describe('施用符水粥', () => {
  it('平民离场、天命 +1、扣 2 AP', () => {
    taiping();
    civ('c1', 1, 0);
    room.state.player1Taiping.destiny = 5;
    room.state.player1ActionPoints = 7;

    room.handleTaipingFushui(client('player1'), { civilianId: 'c1' });

    expect(errors).toEqual([]);
    expect(room.state.units.has('c1')).toBe(false);
    expect(room.state.player1Taiping.destiny).toBe(6);
    expect(room.state.player1ActionPoints).toBe(5);
    expect(FUSHUI_COST).toBe(2);
  });

  it('救济不是击杀：不触发平民死亡扣天命（净 +1 而不是 0）', () => {
    taiping();
    civ('c1', 1, 0);
    room.state.player1Taiping.destiny = 5;
    room.handleTaipingFushui(client('player1'), { civilianId: 'c1' });
    expect(room.state.player1Taiping.destiny).toBe(6);
    expect(room.state.player1Taiping.destinyLostThisRound).toBe(0);
  });

  it('双太平时救济也不会连带扣掉对手太平的天命', () => {
    room = newGame('taiping', 'taiping');
    taiping('player1', 0, 0);
    taiping('player2', 0, -4);
    civ('c1', 1, 0);
    room.state.player1Taiping.destiny = 5;
    room.state.player2Taiping.destiny = 5;

    room.handleTaipingFushui(client('player1'), { civilianId: 'c1' });

    expect(room.state.player1Taiping.destiny).toBe(6);
    expect(room.state.player2Taiping.destiny).toBe(5);
  });

  it('不给士气奖励', () => {
    taiping();
    civ('c1', 1, 0);
    room.handleTaipingFushui(client('player1'), { civilianId: 'c1' });
    expect(room.state.player1KilledThisTurn).toBe(false);
    expect(room.state.player1ActionPoints).toBe(8); // 10 - 2，没有骰子加回来
  });

  it('占一次行动并设 hasAttacked', () => {
    const g = taiping();
    civ('c1', 1, 0);
    room.handleTaipingFushui(client('player1'), { civilianId: 'c1' });
    expect(g.actionsThisTurn).toBe(1);
    expect(g.hasAttacked).toBe(true);
  });

  it('每回合只能用一次', () => {
    taiping();
    civ('c1', 1, 0);
    civ('c2', -1, 0);
    room.handleTaipingFushui(client('player1'), { civilianId: 'c1' });
    errors.length = 0;
    room.handleTaipingFushui(client('player1'), { civilianId: 'c2' });
    expect(errors).toEqual(['符水粥本回合已经用过了']);
    expect(room.state.units.has('c2')).toBe(true);
  });

  it('天命 12 时仍可施用：天命不涨但消耗照付、已用照记', () => {
    taiping();
    civ('c1', 1, 0);
    room.state.player1Taiping.destiny = 12;
    room.state.player1ActionPoints = 7;

    room.handleTaipingFushui(client('player1'), { civilianId: 'c1' });

    expect(errors).toEqual([]);
    expect(room.state.player1Taiping.destiny).toBe(12);
    expect(room.state.player1ActionPoints).toBe(5);
    expect(room.state.player1Taiping.fushuiUsedThisTurn).toBe(true);
    expect(room.state.units.has('c1')).toBe(false);
  });

  it('行动点不足时拒绝，什么都不改', () => {
    taiping();
    civ('c1', 1, 0);
    room.state.player1ActionPoints = 1;
    room.state.player1Taiping.destiny = 5;

    room.handleTaipingFushui(client('player1'), { civilianId: 'c1' });

    expect(errors[0]).toContain('行动点不足');
    expect(room.state.units.has('c1')).toBe(true);
    expect(room.state.player1Taiping.destiny).toBe(5);
    expect(room.state.player1ActionPoints).toBe(1);
  });

  it('非相邻的平民救不到', () => {
    taiping();
    civ('far', 3, 0);
    room.handleTaipingFushui(client('player1'), { civilianId: 'far' });
    expect(errors).toEqual(['只能救济与太平相邻的平民']);
    expect(room.state.units.has('far')).toBe(true);
  });

  it('不是自己的回合时拒绝', () => {
    taiping();
    civ('c1', 1, 0);
    room.state.currentPlayer = 'player2';
    room.handleTaipingFushui(client('player1'), { civilianId: 'c1' });
    expect(errors).toEqual(['不是你的回合']);
  });

  it('太平已阵亡时拒绝', () => {
    civ('c1', 1, 0); // 场上没有太平将军
    room.handleTaipingFushui(client('player1'), { civilianId: 'c1' });
    expect(errors).toEqual(['太平不在场']);
  });
});

describe('与行动次数的交互', () => {
  it('先移动再救济可以', () => {
    const g = taiping();
    civ('c1', 1, 0);
    room.handleMoveUnit(client('player1'), { unitId: g.id, toQ: 0, toR: 1, toS: -1 });
    expect(errors).toEqual([]);
    expect(g.actionsThisTurn).toBe(1);

    // 移动后 (0,1) 与 (1,0) 仍然相邻
    room.handleTaipingFushui(client('player1'), { civilianId: 'c1' });
    expect(errors).toEqual([]);
    expect(g.actionsThisTurn).toBe(2);
    expect(room.state.units.has('c1')).toBe(false);
  });

  it('救济之后不能再普通攻击（hasAttacked 已占）', () => {
    const g = taiping();
    civ('c1', 1, 0);
    const foe = place('f', 'infantry', 'player2', -1, 0);
    room.handleTaipingFushui(client('player1'), { civilianId: 'c1' });
    errors.length = 0;

    room.handleAttackUnit(client('player1'), { attackerId: g.id, targetId: foe.id });

    expect(errors).toEqual(['该单位本回合已攻击过']);
    expect(foe.hp).toBe(2);
  });

  it('普通攻击之后不能再救济（双向互斥）', () => {
    const g = taiping();
    civ('c1', 1, 0);
    const foe = place('f', 'infantry', 'player2', -1, 0);
    room.handleAttackUnit(client('player1'), { attackerId: g.id, targetId: foe.id });
    expect(errors).toEqual([]);
    errors.length = 0;

    room.handleTaipingFushui(client('player1'), { civilianId: 'c1' });

    expect(errors).toEqual(['太平本回合已使用攻击类行动，不能再施符水粥']);
    expect(room.state.units.has('c1')).toBe(true);
  });

  it('移动两次后行动用尽，救济被拒', () => {
    const g = taiping();
    civ('c1', 1, 0);
    g.actionsThisTurn = 2;
    room.handleTaipingFushui(client('player1'), { civilianId: 'c1' });
    expect(errors).toEqual(['太平本回合行动次数已用尽']);
  });
});

describe('回合边界', () => {
  it('新回合开始时每回合额度回满', () => {
    taiping();
    civ('c1', 1, 0);
    room.handleTaipingFushui(client('player1'), { civilianId: 'c1' });
    expect(room.state.player1Taiping.fushuiUsedThisTurn).toBe(true);

    room.rollDiceForPlayer('player1');
    expect(room.state.player1Taiping.fushuiUsedThisTurn).toBe(false);
  });
});

describe('下发给客户端的高亮', () => {
  it('validActions 带上可救济目标', () => {
    taiping();
    civ('c1', 1, 0);
    civ('far', 3, 0);
    expect(room.buildValidActions().fushuiTargets).toEqual(['c1']);
  });

  it('用过之后高亮清空', () => {
    taiping();
    civ('c1', 1, 0);
    civ('c2', -1, 0);
    room.handleTaipingFushui(client('player1'), { civilianId: 'c1' });
    expect(room.buildValidActions().fushuiTargets).toEqual([]);
  });

  it('非太平方拿到的是空列表', () => {
    room = newGame('wushuang', 'shenji');
    place('gw', 'general', 'player1', 0, 0, { generalType: 'wushuang', hp: 4, maxHp: 4 });
    civ('c1', 1, 0);
    expect(room.buildValidActions().fushuiTargets).toEqual([]);
  });
});
