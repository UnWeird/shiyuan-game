import { beforeEach, describe, expect, it } from 'vitest';
import { ShiyuanRoom } from '../rooms/ShiyuanRoom';
import { GameStateSchema, UnitSchema } from '../schema/GameState';
import {
  CIVILIAN_TAG,
  MOVE_FLAG_ZUOLUAN,
  getZuoluanSources,
  getZuoluanThreatHexes,
  wouldTriggerZuoluan,
  type UnitLike,
} from '../../../shared/rules/queries';

/**
 * 太平 · 作乱
 *
 * 贼不能主动攻击，威胁全在这里。四条最容易写错的：
 *   - 无论相邻多少贼，同一次行动**最多 1 点**（旧实现是「相邻贼数量」点，正相反）
 *   - 所有相邻且充满的贼**同时**耗尽，不是只耗一个
 *   - 移动只看终点；其他行动看行动前的当前位置
 *   - 夺营要**先**结算作乱，活下来才算赢（§9.1）
 */

type RoomProbe = {
  state: GameStateSchema;
  setState: (s: GameStateSchema) => void;
  rng: () => number;
  unitList: UnitLike[];
  applyZuoluan: (u: UnitSchema) => boolean;
  handleMoveUnit: (c: unknown, d: { unitId: string; toQ: number; toR: number; toS: number }) => void;
  handleAttackUnit: (c: unknown, d: { attackerId: string; targetId: string }) => void;
  handleRotateUnit: (c: unknown, d: { unitId: string; direction: number }) => void;
  handleDeployUnit: (c: unknown, d: unknown) => void;
  buildValidActions: () => {
    moves: Record<string, Array<[number, number, number, number]>>;
    zuoluanHexes: Array<[number, number]>;
  };
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

function newGame(): RoomProbe {
  const r = new ShiyuanRoom() as unknown as RoomProbe;
  r.setState(new GameStateSchema());
  r.state.phase = 'action';
  r.state.currentPlayer = 'player2';
  r.state.player1General = 'taiping';
  r.state.player2General = 'wushuang';
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

/** 充能的黄巾贼（player1 方） */
const zei = (id: string, q: number, r: number, charged = true) =>
  place(id, 'huangjin_zei', 'player1', q, r, { hp: 2, maxHp: 2, charged });

const U = (u: UnitSchema) => u as unknown as UnitLike;

beforeEach(() => {
  errors.length = 0;
  room = newGame();
});

describe('作乱来源（纯函数）', () => {
  it('相邻的充能贼才算', () => {
    const v = place('v', 'infantry', 'player2', 0, 0);
    zei('near', 1, 0, true);
    zei('far', 3, 0, true);
    zei('drained', 0, 1, false);
    expect(getZuoluanSources(U(v), room.unitList).map(z => z.id)).toEqual(['near']);
  });

  it('不分敌我：太平自己的步兵也会被自家贼作乱', () => {
    const own = place('own', 'infantry', 'player1', 0, 0);
    zei('z', 1, 0);
    expect(wouldTriggerZuoluan(U(own), room.unitList)).toBe(true);
  });

  it('自家力士也会挨（力士不是贼）', () => {
    const l = place('l', 'huangjin_lishi', 'player1', 0, 0);
    zei('z', 1, 0);
    expect(wouldTriggerZuoluan(U(l), room.unitList)).toBe(true);
  });

  it('贼对贼豁免', () => {
    const z1 = zei('z1', 0, 0);
    zei('z2', 1, 0);
    expect(getZuoluanSources(U(z1), room.unitList)).toEqual([]);
  });

  it('平民也会被作乱（非贼单位一律生效）', () => {
    const c = place('c', 'neutral_marker', 'neutral', 0, 0, { hp: 1, maxHp: 1, statusTag: CIVILIAN_TAG });
    zei('z', 1, 0);
    expect(wouldTriggerZuoluan(U(c), room.unitList)).toBe(true);
  });

  it('机关按体积相邻判定，不只是中心格', () => {
    // player2 的弩车占 (0,0)、(1,-1)、(0,-1) 三格。
    // (2,-1) 与车身格 (1,-1) 相邻，但与中心格 (0,0) 距离 2 ——
    // 只查中心格的实现会漏掉这只贼。
    const bal = place('bal', 'ballista', 'player2', 0, 0);
    zei('z', 2, -1);

    expect(getZuoluanSources(U(bal), room.unitList).map(z => z.id)).toEqual(['z']);

    // 对照：同一位置换成占一格的步兵就够不着了
    const inf = place('inf', 'infantry', 'player2', 0, 0);
    expect(getZuoluanSources(U(inf), room.unitList)).toEqual([]);
  });
});

describe('威胁格（纯函数）', () => {
  it('是充能贼的邻格并集', () => {
    zei('z', 0, 0);
    const hexes = getZuoluanThreatHexes(room.unitList);
    expect(hexes).toHaveLength(6);
    expect(hexes.some(h => h.q === 1 && h.r === 0)).toBe(true);
    expect(hexes.some(h => h.q === 0 && h.r === 0)).toBe(false); // 贼自己站的格不算
  });

  it('耗尽的贼不产生威胁格', () => {
    zei('z', 0, 0, false);
    expect(getZuoluanThreatHexes(room.unitList)).toEqual([]);
  });

  it('两只贼的邻格去重', () => {
    zei('a', 0, 0);
    zei('b', 2, 0);
    const hexes = getZuoluanThreatHexes(room.unitList);
    // (1,0) 同时是两者的邻格，只能出现一次
    expect(hexes.filter(h => h.q === 1 && h.r === 0)).toHaveLength(1);
  });

  it('不越出棋盘', () => {
    zei('z', 0, 5);
    for (const h of getZuoluanThreatHexes(room.unitList)) {
      expect(Math.max(Math.abs(h.q), Math.abs(h.r), Math.abs(-h.q - h.r))).toBeLessThanOrEqual(5);
    }
  });
});

describe('伤害与充能', () => {
  it('相邻 1 只贼 → 1 点伤害，该贼耗尽', () => {
    const v = place('v', 'infantry', 'player2', 0, 0);
    const z = zei('z', 1, 0);
    expect(room.applyZuoluan(v)).toBe(false);
    expect(v.hp).toBe(1);
    expect(z.charged).toBe(false);
  });

  it('相邻 3 只贼 → 仍然只 1 点，但 3 只同时耗尽', () => {
    const v = place('v', 'infantry', 'player2', 0, 0);
    const a = zei('a', 1, 0);
    const b = zei('b', 0, 1);
    const c = zei('c', -1, 0);
    room.applyZuoluan(v);
    expect(v.hp).toBe(1);
    expect([a.charged, b.charged, c.charged]).toEqual([false, false, false]);
  });

  it('只耗尽充满的那些，已耗尽的不受影响', () => {
    const v = place('v', 'infantry', 'player2', 0, 0);
    const full = zei('full', 1, 0, true);
    const drained = zei('drained', 0, 1, false);
    room.applyZuoluan(v);
    expect(full.charged).toBe(false);
    expect(drained.charged).toBe(false);
  });

  it('贼本身不掉血', () => {
    const v = place('v', 'infantry', 'player2', 0, 0);
    const z = zei('z', 1, 0);
    room.applyZuoluan(v);
    expect(z.hp).toBe(2);
  });

  it('不消耗任何一方的行动点', () => {
    const v = place('v', 'infantry', 'player2', 0, 0);
    zei('z', 1, 0);
    const before = { p1: room.state.player1ActionPoints, p2: room.state.player2ActionPoints };
    room.applyZuoluan(v);
    expect(room.state.player1ActionPoints).toBe(before.p1);
    expect(room.state.player2ActionPoints).toBe(before.p2);
  });

  it('打死单位时不给任何人士气奖励', () => {
    const v = place('v', 'infantry', 'player2', 0, 0, { hp: 1 });
    zei('z', 1, 0);
    expect(room.applyZuoluan(v)).toBe(true);
    expect(room.state.units.has('v')).toBe(false);
    expect(room.state.player1KilledThisTurn).toBe(false);
    expect(room.state.player2KilledThisTurn).toBe(false);
  });

  it('打死对方将领也不需要攻击方付额外 AP', () => {
    const g = place('gw', 'general', 'player2', 0, 0, { generalType: 'wushuang', hp: 1, maxHp: 4 });
    zei('z', 1, 0);
    const before = room.state.player1ActionPoints;
    expect(room.applyZuoluan(g)).toBe(true);
    expect(room.state.player1ActionPoints).toBe(before);
  });

  it('打死力士时走信仰不死，化为平民', () => {
    const l = place('l', 'huangjin_lishi', 'player1', 0, 0, { hp: 1 });
    zei('z', 1, 0);
    expect(room.applyZuoluan(l)).toBe(true);
    expect(room.state.units.has('l')).toBe(false);
    expect(Array.from(room.state.units.values()).some(u => u.statusTag === CIVILIAN_TAG)).toBe(true);
  });

  it('没有相邻充能贼时什么都不做', () => {
    const v = place('v', 'infantry', 'player2', 0, 0);
    zei('z', 3, 0);
    expect(room.applyZuoluan(v)).toBe(false);
    expect(v.hp).toBe(2);
  });
});

describe('移动：只看终点', () => {
  it('走进充能贼旁边 → 挨 1 点', () => {
    const v = place('v', 'infantry', 'player2', 2, 0);
    const z = zei('z', 0, 0);
    room.handleMoveUnit(client('player2'), { unitId: v.id, toQ: 1, toR: 0, toS: -1 });
    expect(errors).toEqual([]);
    expect(v.hp).toBe(1);
    expect(z.charged).toBe(false);
  });

  it('从贼旁边走开 → 不挨打（起点不算）', () => {
    const v = place('v', 'infantry', 'player2', 1, 0);
    const z = zei('z', 0, 0);
    room.handleMoveUnit(client('player2'), { unitId: v.id, toQ: 2, toR: 0, toS: -2 });
    expect(v.hp).toBe(2);
    expect(z.charged).toBe(true);
  });

  it('贼自己移动不触发自身作乱', () => {
    room.state.currentPlayer = 'player1';
    const z = zei('z', 0, 0, false);
    room.handleMoveUnit(client('player1'), { unitId: z.id, toQ: 1, toR: 0, toS: -1 });
    expect(z.hp).toBe(2);
    expect(z.charged).toBe(true); // 移动回充
  });

  it('贼走到另一只充能贼旁边也不触发', () => {
    room.state.currentPlayer = 'player1';
    const moving = zei('m', 2, 0, false);
    const stander = zei('s', 0, 0, true);
    room.handleMoveUnit(client('player1'), { unitId: moving.id, toQ: 1, toR: 0, toS: -1 });
    expect(moving.hp).toBe(2);
    expect(stander.charged).toBe(true);
  });
});

describe('§9.1 夺营：先作乱，活下来才算赢', () => {
  it('冲进大本营被作乱打死 → 不判胜利', () => {
    const v = place('v', 'infantry', 'player2', 0, 4, { hp: 1 });
    zei('guard', 1, 4); // 与大本营 (0,5) 相邻
    room.handleMoveUnit(client('player2'), { unitId: v.id, toQ: 0, toR: 5, toS: -5 });
    expect(room.state.units.has('v')).toBe(false);
    expect(room.state.phase).toBe('action');
  });

  it('冲进大本营挨 1 点但活着 → 判胜利', () => {
    const v = place('v', 'infantry', 'player2', 0, 4, { hp: 2 });
    zei('guard', 1, 4);
    room.handleMoveUnit(client('player2'), { unitId: v.id, toQ: 0, toR: 5, toS: -5 });
    expect(v.hp).toBe(1);
    expect(room.state.phase).toBe('end');
  });

  it('大本营旁边没有充能贼时照常获胜', () => {
    const v = place('v', 'infantry', 'player2', 0, 4, { hp: 1 });
    zei('guard', 1, 4, false); // 已耗尽
    room.handleMoveUnit(client('player2'), { unitId: v.id, toQ: 0, toR: 5, toS: -5 });
    expect(room.state.phase).toBe('end');
  });
});

describe('非移动行动：效果生效前判定', () => {
  it('攻击：先挨 1 点再结算攻击', () => {
    const a = place('a', 'infantry', 'player2', 0, 0);
    const t = place('t', 'infantry', 'player1', 1, 0);
    zei('z', 0, 1);
    room.handleAttackUnit(client('player2'), { attackerId: a.id, targetId: t.id });
    expect(errors).toEqual([]);
    expect(a.hp).toBe(1);
    expect(t.hp).toBe(1); // 攻击照常结算
  });

  it('攻击：作乱先把攻击者打死 → 攻击被取消，AP 不返还', () => {
    const a = place('a', 'infantry', 'player2', 0, 0, { hp: 1 });
    const t = place('t', 'infantry', 'player1', 1, 0);
    zei('z', 0, 1);
    room.state.player2ActionPoints = 5;

    room.handleAttackUnit(client('player2'), { attackerId: a.id, targetId: t.id });

    expect(room.state.units.has('a')).toBe(false);
    expect(t.hp).toBe(2);                        // 攻击没有生效
    expect(room.state.player2ActionPoints).toBe(4); // 已付的 1 点不返还
  });

  it('转向：先挨 1 点，朝向照常改变', () => {
    const ar = place('ar', 'archer', 'player2', 0, 0, { direction: 0 });
    zei('z', 1, 0);
    room.handleRotateUnit(client('player2'), { unitId: ar.id, direction: 3 });
    expect(ar.hp).toBe(1);
    expect(ar.direction).toBe(3);
  });

  it('转向：被作乱打死则转向取消', () => {
    const ar = place('ar', 'archer', 'player2', 0, 0, { direction: 0, hp: 1 });
    zei('z', 1, 0);
    room.state.player2ActionPoints = 5;
    room.handleRotateUnit(client('player2'), { unitId: ar.id, direction: 3 });
    expect(room.state.units.has('ar')).toBe(false);
    expect(room.state.player2ActionPoints).toBe(4);
  });

  it('部署：落地即挨 1 点，但 2 血单位不会被取消', () => {
    room.state.phase = 'deploy';
    room.state.currentPlayer = 'player2';
    room.state.player2Infantry = 5;
    zei('z', 1, -4);
    room.handleDeployUnit(client('player2'), {
      unitType: 'infantry',
      position: { q: 0, r: -4, s: 4 },
    });
    const deployed = Array.from(room.state.units.values()).find(u => u.type === 'infantry');
    expect(deployed).toBeTruthy();
    expect(deployed!.hp).toBe(1);
  });
});

describe('下发给客户端', () => {
  it('移动落点带上作乱标记', () => {
    room.state.currentPlayer = 'player2';
    const v = place('v', 'infantry', 'player2', 2, 0);
    zei('z', 0, 0);
    const moves = room.buildValidActions().moves[v.id]!;
    const toward = moves.find(([q, r]) => q === 1 && r === 0)!;
    const away = moves.find(([q, r]) => q === 3 && r === 0)!;
    expect(toward[3] & MOVE_FLAG_ZUOLUAN).toBeTruthy();
    expect(away[3] & MOVE_FLAG_ZUOLUAN).toBeFalsy();
  });

  it('贼自己的落点不带作乱标记（贼对贼豁免）', () => {
    room.state.currentPlayer = 'player1';
    const moving = zei('m', 2, 0, false);
    zei('s', 0, 0, true);
    const moves = room.buildValidActions().moves[moving.id]!;
    const toward = moves.find(([q, r]) => q === 1 && r === 0)!;
    expect(toward[3] & MOVE_FLAG_ZUOLUAN).toBeFalsy();
  });

  it('威胁格一起下发', () => {
    room.state.currentPlayer = 'player2';
    place('v', 'infantry', 'player2', 3, 0);
    zei('z', 0, 0);
    expect(room.buildValidActions().zuoluanHexes).toHaveLength(6);
  });
});

describe('接入点的收口', () => {
  it('所有会生效的行动路径都挂了作乱钩子', () => {
    // 漏掉一条就是一个「在贼旁边用某个技能不挨打」的隐形漏洞。
    // 当前 8 处：移动、普通攻击、转向、部署、弩车贯穿、弩车近战、
    // 投石车蓄力、无双扇形（performFanAttack 一处覆盖三段）。
    const fs = require('node:fs') as typeof import('node:fs');
    const src = fs.readFileSync(new URL('../rooms/ShiyuanRoom.ts', import.meta.url), 'utf-8');
    const hooks = (src.match(/this\.applyZuoluan\(/g) ?? []).length;
    expect(hooks).toBe(8);
  });
});
