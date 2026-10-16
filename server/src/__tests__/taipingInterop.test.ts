import { beforeEach, describe, expect, it } from 'vitest';
import { ShiyuanRoom } from '../rooms/ShiyuanRoom';
import { GameStateSchema, UnitSchema } from '../schema/GameState';
import {
  CIVILIAN_CAP,
  CIVILIAN_TAG,
  countCivilians,
  getCivilianSpawnRange,
  getDoufanTargets,
  type UnitLike,
} from '../../../shared/rules/queries';
import { getMachineOccupiedHexes, isInStartZone } from '../../../shared/utils/hexUtils';

/**
 * 太平 · 交互边界（§9）
 *
 * 这一组测的不是太平自己的规则，而是它和**别人**的接缝：
 * 双太平之间、与仁德、与机关。这些地方的 bug 不会在单独打太平时出现，
 * 所以必须单独钉住。
 */

type RoomProbe = {
  state: GameStateSchema;
  setState: (s: GameStateSchema) => void;
  rng: () => number;
  unitList: UnitLike[];
  killUnit: (u: UnitSchema) => void;
  canCommandUnit: (u: UnitSchema, role: 'player1' | 'player2') => boolean;
  refreshCivilians: (role: 'player1' | 'player2') => void;
  startCorruptPhase: (role: 'player1' | 'player2') => void;
  settleDestiny: (role: 'player1' | 'player2') => void;
  applyZuoluan: (u: UnitSchema) => boolean;
  handleMoveUnit: (c: unknown, d: { unitId: string; toQ: number; toR: number; toS: number }) => void;
  handleRendeConvertToInfantry: (c: unknown, d: { targetId: string }) => void;
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

function newGame(p1: string, p2: string): RoomProbe {
  const r = new ShiyuanRoom() as unknown as RoomProbe;
  r.setState(new GameStateSchema());
  r.state.phase = 'action';
  r.state.currentPlayer = 'player1';
  r.state.player1General = p1;
  r.state.player2General = p2;
  r.state.player1ActionPoints = 20;
  r.state.player2ActionPoints = 20;
  r.state.player1DeployedValue = 4;
  r.state.player2DeployedValue = 4;
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

const taiping = (role: 'player1' | 'player2', q: number, r: number) =>
  place(`g_${role}`, 'general', role, q, r, { generalType: 'taiping', hp: 3, maxHp: 3 });

const lishi = (id: string, owner: 'player1' | 'player2', q: number, r: number) =>
  place(id, 'huangjin_lishi', owner, q, r, { hp: 2, maxHp: 2 });

const zei = (id: string, owner: 'player1' | 'player2', q: number, r: number, charged = true) =>
  place(id, 'huangjin_zei', owner, q, r, { hp: 2, maxHp: 2, charged });

beforeEach(() => {
  errors.length = 0;
});

describe('§9.5 双太平', () => {
  beforeEach(() => {
    room = newGame('taiping', 'taiping');
  });

  it('天命各自独立，不共享', () => {
    taiping('player1', 0, 4);
    taiping('player2', 0, -4);
    room.state.player1Taiping.destiny = 11;
    room.state.player2Taiping.destiny = 2;
    room.rng = () => 0.5;
    room.settleDestiny('player1');
    expect(room.state.player1Taiping.destiny).toBe(11);
    expect(room.state.player2Taiping.destiny).toBe(2);
  });

  it('体力各自独立，不共享血池（旧实现是共享 6 血）', () => {
    const g1 = taiping('player1', 0, 4);
    const g2 = taiping('player2', 0, -4);
    room.state.player1Taiping.destiny = 0; // 承载 1
    lishi('a', 'player1', 0, 0);
    lishi('b', 'player1', 1, 0);
    room.rng = () => 0.5;
    room.settleDestiny('player1');
    expect(g1.hp).toBe(2);
    expect(g2.hp).toBe(3); // 对面毫发无伤
  });

  it('不共享单位控制权：不能指挥对面的力士', () => {
    const mine = lishi('mine', 'player1', 0, 0);
    const theirs = lishi('theirs', 'player2', 1, 0);
    expect(room.canCommandUnit(mine, 'player1')).toBe(true);
    expect(room.canCommandUnit(theirs, 'player1')).toBe(false);
    expect(room.canCommandUnit(mine, 'player2')).toBe(false);
  });

  it('承载量只看己方力士', () => {
    const g1 = taiping('player1', 0, 4);
    taiping('player2', 0, -4);
    room.state.player1Taiping.destiny = 5; // 承载 4
    for (let i = 0; i < 2; i++) lishi(`m${i}`, 'player1', i, 0);
    for (let i = 0; i < 6; i++) lishi(`t${i}`, 'player2', i - 3, -1);
    room.rng = () => 0.5;
    room.settleDestiny('player1');
    expect(g1.hp).toBe(3); // 自己只有 2 个力士，不超载
  });

  it('共享公共平民与 5 名总量上限', () => {
    taiping('player1', 0, 4);
    taiping('player2', 0, -4);
    room.state.player1Taiping.destiny = 12; // 各刷 3
    room.state.player2Taiping.destiny = 12;
    room.refreshCivilians('player1');
    expect(countCivilians(room.unitList)).toBe(3);
    room.refreshCivilians('player2');
    expect(countCivilians(room.unitList)).toBe(CIVILIAN_CAP); // 只补到 5
  });

  it('公共平民死亡时，双方仍存活的太平都失去天命', () => {
    taiping('player1', 0, 4);
    taiping('player2', 0, -4);
    room.state.player1Taiping.destiny = 8;
    room.state.player2Taiping.destiny = 3;
    room.killUnit(civ('c1', 0, 0));
    expect(room.state.player1Taiping.destiny).toBe(7);
    expect(room.state.player2Taiping.destiny).toBe(2);
  });

  it('低天命时刷新范围各自含自己那一侧的起始区', () => {
    const p1 = getCivilianSpawnRange(0, 'player1');
    const p2 = getCivilianSpawnRange(0, 'player2');
    expect(p1.filter(h => isInStartZone(h, 'top'))).toHaveLength(21);
    expect(p1.filter(h => isInStartZone(h, 'bottom'))).toHaveLength(0);
    expect(p2.filter(h => isInStartZone(h, 'bottom'))).toHaveLength(21);
    expect(p2.filter(h => isInStartZone(h, 'top'))).toHaveLength(0);
  });

  it('豆饭的征募名单各自只含自己的征募源覆盖的平民', () => {
    place('s1', 'infantry', 'player1', 0, 1);
    place('s2', 'infantry', 'player2', 0, -3);
    civ('near1', 0, 0);   // 距 s1 1 格，距 s2 3 格
    civ('near2', 0, -2);  // 距 s2 1 格，距 s1 3 格
    expect(getDoufanTargets(room.unitList, 'player1')).toEqual(['near1']);
    expect(getDoufanTargets(room.unitList, 'player2')).toEqual(['near2']);
  });

  it('黄巾单位的夺营胜利各自独立判定', () => {
    // player1 的力士冲 player2 的大本营
    const l = lishi('l1', 'player1', 0, -4);
    room.handleMoveUnit(client('player1'), { unitId: l.id, toQ: 0, toR: -5, toS: 5 });
    expect(errors).toEqual([]);
    expect(room.state.phase).toBe('end');
  });

  it('一方阵亡只起义自己那边；两边的贼各自作乱', () => {
    const g1 = taiping('player1', 0, 4);
    taiping('player2', 0, -4);
    lishi('a', 'player1', 0, 0);
    lishi('b', 'player2', 2, 0);
    room.killUnit(g1);
    expect(room.state.units.get('a')!.type).toBe('huangjin_zei');
    expect(room.state.units.get('b')!.type).toBe('huangjin_lishi');

    // player1 的贼会打到走到它旁边的任何非贼单位，包括 player2 的力士
    const victim = room.state.units.get('b')!;
    victim.q = 1; victim.r = 0; victim.s = -1;
    expect(room.applyZuoluan(victim)).toBe(false);
    expect(victim.hp).toBe(1);
  });

  it('腐化队列各自独立', () => {
    zei('z1', 'player1', 0, 0);
    zei('z2', 'player2', 2, 0);
    civ('shared', 1, 0); // 两只贼都挨着它
    room.startCorruptPhase('player1');
    room.startCorruptPhase('player2');
    expect(Array.from(room.state.player1Taiping.pendingCorrupt)).toEqual(['z1']);
    expect(Array.from(room.state.player2Taiping.pendingCorrupt)).toEqual(['z2']);
  });
});

describe('§9.4 与仁德', () => {
  beforeEach(() => {
    room = newGame('taiping', 'rende');
  });

  it('公共平民可以被仁德按原有规则收编为步兵', () => {
    const rende = place('gr', 'general', 'player2', 1, 0, {
      generalType: 'rende', hp: 4, maxHp: 4, canConvertNeutral: true, convertInfantryCost: 1,
    });
    civ('c1', 0, 0);
    room.state.currentPlayer = 'player2';
    room.state.player2ActionPoints = 5;

    room.handleRendeConvertToInfantry(client('player2'), { targetId: 'c1' });

    expect(errors).toEqual([]);
    const born = Array.from(room.state.units.values()).find(u => u.type === 'infantry');
    expect(born?.owner).toBe('player2');
    expect(room.state.player2ActionPoints).toBe(4);
    expect(rende.convertInfantryCost).toBe(2); // 费用照常翻倍
  });

  it('收编不是击杀：太平不因此失去天命', () => {
    taiping('player1', 0, 4);
    place('gr', 'general', 'player2', 1, 0, {
      generalType: 'rende', hp: 4, maxHp: 4, canConvertNeutral: true, convertInfantryCost: 1,
    });
    civ('c1', 0, 0);
    room.state.player1Taiping.destiny = 7;
    room.state.currentPlayer = 'player2';

    room.handleRendeConvertToInfantry(client('player2'), { targetId: 'c1' });

    expect(room.state.player1Taiping.destiny).toBe(7);
  });

  it('被仁德收编走的平民不再是征募目标', () => {
    place('src', 'infantry', 'player1', 0, 1);
    place('gr', 'general', 'player2', 1, 0, {
      generalType: 'rende', hp: 4, maxHp: 4, canConvertNeutral: true, convertInfantryCost: 1,
    });
    civ('c1', 0, 0);
    expect(getDoufanTargets(room.unitList, 'player1')).toEqual(['c1']);

    room.state.currentPlayer = 'player2';
    room.handleRendeConvertToInfantry(client('player2'), { targetId: 'c1' });
    expect(getDoufanTargets(room.unitList, 'player1')).toEqual([]);
  });

  it('仁德自己造的中立标记不会被太平征募或救济', () => {
    place('src', 'infantry', 'player1', 0, 1);
    place('n1', 'neutral_marker', 'neutral', 0, 0, { hp: 1, maxHp: 1 });
    expect(getDoufanTargets(room.unitList, 'player1')).toEqual([]);
  });
});

describe('§9 与机关', () => {
  beforeEach(() => {
    room = newGame('taiping', 'shenji');
  });

  it('机关不是豆饭征募源（弩车/战车/投石车都不算）', () => {
    place('bal', 'ballista', 'player1', 0, 2);
    place('cha', 'chariot', 'player1', 3, 1);
    place('cat', 'catapult', 'player1', -3, 1);
    civ('c1', 0, 1);
    civ('c2', 2, 1);
    civ('c3', -2, 1);
    expect(getDoufanTargets(room.unitList, 'player1')).toEqual([]);
  });

  it('平民不会刷在机关车身上：只剩车身时一个都刷不出来', () => {
    taiping('player1', 0, 4);
    place('bal', 'ballista', 'player2', 0, 0);
    // player2 的弩车占 (0,0)、(1,-1)、(0,-1)
    const body = getMachineOccupiedHexes({ q: 0, r: 0, s: 0 }, 'ballista', false);
    expect(body).toHaveLength(3);

    room.state.player1Taiping.destiny = 9; // 刷新范围 = 交战区 49 格
    let n = 0;
    for (const hex of getCivilianSpawnRange(9, 'player1')) {
      if (body.some(b => b.q === hex.q && b.r === hex.r)) continue; // 车身留着
      place(`blk${n++}`, 'infantry', 'player2', hex.q, hex.r);
    }

    room.refreshCivilians('player1');
    // 范围里仅剩的 3 个「空」格全是车身 —— 车身被排除，所以刷不出来
    expect(countCivilians(room.unitList)).toBe(0);
  });

  it('战车碾压平民：范围伤害，不额外收 AP，但仍扣天命', () => {
    taiping('player1', 0, 4);
    room.state.player1Taiping.destiny = 7;
    const chariot = place('cha', 'chariot', 'player2', 0, -1);
    // 战车只碾压**落点车身**覆盖的格子（不是沿途）。
    // player2 战车落在 (0,1) 时车身是 (0,1)/(1,0)/(1,1)/(0,2)，
    // 所以平民要摆在车身里才会被碾到。
    civ('victim', 1, 1);
    room.state.currentPlayer = 'player2';
    room.state.player2ActionPoints = 5;

    // player2 战车从 (0,-1) 可以走到 (0,1)，路径经过 (0,0) —— 平民就站在那
    const before = room.state.player2ActionPoints;
    room.handleMoveUnit(client('player2'), { unitId: chariot.id, toQ: 0, toR: 1, toS: -1 });

    expect(errors).toEqual([]);
    expect(room.state.units.has('victim')).toBe(false);  // 确实被碾死了
    // 碾压只收移动的 1 点，不收「主动攻击平民」的那额外 1 点
    expect(before - room.state.player2ActionPoints).toBe(1);
    // 但它仍然是「平民被击杀」：天命照扣，士气照样不给
    expect(room.state.player1Taiping.destiny).toBe(6);
    expect(room.state.player2KilledThisTurn).toBe(false);
  });
});
