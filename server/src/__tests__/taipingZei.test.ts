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
 * 太平 · 黄巾贼与起义转化（「苍天已死」阶段的入口）
 *
 * 太平倒下的瞬间，全部力士化为贼：继承体力、立即充满作乱充能。
 * 贼不能主动攻击，威胁全靠被动的「作乱」（步骤 10），
 * 而充能只能靠**主动移动**回满 —— 被击退不算。
 */

type RoomProbe = {
  state: GameStateSchema;
  setState: (s: GameStateSchema) => void;
  rng: () => number;
  unitList: UnitLike[];
  killUnit: (u: UnitSchema) => void;
  applyQiyi: (role: 'player1' | 'player2') => void;
  settleDestiny: (role: 'player1' | 'player2') => void;
  refreshCivilians: (role: 'player1' | 'player2') => void;
  startDoufanPhase: (role: 'player1' | 'player2') => void;
  rollDiceForPlayer: (role: 'player1' | 'player2') => void;
  handleMoveUnit: (c: unknown, d: { unitId: string; toQ: number; toR: number; toS: number }) => void;
  handleAttackUnit: (c: unknown, d: { attackerId: string; targetId: string }) => void;
  grantFirstKillReward: (role: 'player1' | 'player2', victim: UnitSchema, label?: string) => boolean;
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

const taiping = (role: 'player1' | 'player2' = 'player1', q = 0, r = 4) =>
  place(`g_${role}`, 'general', role, q, r, { generalType: 'taiping', hp: 3, maxHp: 3 });

const lishi = (id: string, owner: 'player1' | 'player2', q: number, r: number, hp = 2) =>
  place(id, 'huangjin_lishi', owner, q, r, { hp, maxHp: 2 });

const zei = (id: string, owner: 'player1' | 'player2', q: number, r: number, extra: Partial<UnitSchema> = {}) =>
  place(id, 'huangjin_zei', owner, q, r, { hp: 2, maxHp: 2, charged: true, ...extra });

const U = (u: UnitSchema) => u as unknown as UnitLike;

const zeiUnits = () =>
  Array.from(room.state.units.values()).filter(u => u.type === 'huangjin_zei');

beforeEach(() => {
  errors.length = 0;
  room = newGame();
});

describe('起义转化', () => {
  it('太平阵亡 → 己方全部力士化为贼', () => {
    const g = taiping('player1');
    lishi('l1', 'player1', 0, 0);
    lishi('l2', 'player1', 1, 0);
    room.killUnit(g);
    expect(zeiUnits().map(u => u.id).sort()).toEqual(['l1', 'l2']);
    expect(room.state.units.has('l1')).toBe(true); // 原地改 type，id 不变
  });

  it('继承转化前的剩余体力', () => {
    const g = taiping('player1');
    lishi('full', 'player1', 0, 0, 2);
    lishi('hurt', 'player1', 1, 0, 1);
    room.killUnit(g);
    expect(room.state.units.get('full')!.hp).toBe(2);
    expect(room.state.units.get('hurt')!.hp).toBe(1);
  });

  it('转化时立即获得充满的作乱充能', () => {
    const g = taiping('player1');
    lishi('l1', 'player1', 0, 0);
    expect(room.state.units.get('l1')!.charged).toBe(false);
    room.killUnit(g);
    expect(room.state.units.get('l1')!.charged).toBe(true);
  });

  it('仍归原太平玩家控制', () => {
    const g = taiping('player1');
    lishi('l1', 'player1', 0, 0);
    room.killUnit(g);
    expect(room.state.units.get('l1')!.owner).toBe('player1');
  });

  it('只转化己方力士', () => {
    const g = taiping('player1');
    lishi('mine', 'player1', 0, 0);
    lishi('theirs', 'player2', 1, 0);
    room.killUnit(g);
    expect(room.state.units.get('mine')!.type).toBe('huangjin_zei');
    expect(room.state.units.get('theirs')!.type).toBe('huangjin_lishi');
  });

  it('没有力士时起义是空操作，不写战报', () => {
    const g = taiping('player1');
    room.killUnit(g);
    expect(room.state.battleLog.some(l => l.includes('起义！'))).toBe(false);
  });

  it('双太平：一方阵亡只转化那一方的力士', () => {
    room = newGame('taiping', 'taiping');
    const g1 = taiping('player1', 0, 4);
    taiping('player2', 0, -4);
    lishi('a', 'player1', 0, 0);
    lishi('b', 'player2', 1, 0);
    room.killUnit(g1);
    expect(room.state.units.get('a')!.type).toBe('huangjin_zei');
    expect(room.state.units.get('b')!.type).toBe('huangjin_lishi');
  });

  it('被天命难承压死也触发起义（同一个死亡出口）', () => {
    const g = taiping('player1');
    g.hp = 1;
    room.state.player1Taiping.destiny = 0; // 承载 1
    lishi('l1', 'player1', 0, 0);
    lishi('l2', 'player1', 1, 0);
    room.rng = () => 0.5; // 骰子相等
    room.settleDestiny('player1');
    expect(room.state.units.has(g.id)).toBe(false);
    expect(zeiUnits()).toHaveLength(2);
  });

  it('未完成的豆饭征募随太平阵亡而中止', () => {
    const g = taiping('player1', 0, 1);
    place('src', 'infantry', 'player1', 0, 0);
    place('c1', 'neutral_marker', 'neutral', 1, 0, { hp: 1, maxHp: 1, statusTag: CIVILIAN_TAG });
    room.startDoufanPhase('player1');
    expect(room.state.player1Taiping.pendingRecruit.length).toBe(1);

    room.killUnit(g);
    expect(room.state.player1Taiping.pendingRecruit.length).toBe(0);
  });
});

describe('贼不能主动攻击', () => {
  it('相邻敌人也打不到', () => {
    const z = zei('z1', 'player1', 0, 0);
    const foe = place('f', 'infantry', 'player2', 1, 0);
    const res = checkAttackLegality(U(z), U(foe), room.unitList);
    expect(res.ok).toBe(false);
    expect((res as { reason: string }).reason).toBe('黄巾贼不能主动攻击');
    expect(getAttackableTargets(U(z), room.unitList)).toEqual([]);
  });

  it('远处的敌人也不行 —— 不会落进「没有射程判定」的分支', () => {
    const z = zei('z1', 'player1', 0, 0);
    const across = place('f', 'infantry', 'player2', -5, 0);
    expect(checkAttackLegality(U(z), U(across), room.unitList).ok).toBe(false);
  });

  it('端到端：服务端拒绝贼的攻击指令', () => {
    const z = zei('z1', 'player1', 0, 0);
    const foe = place('f', 'infantry', 'player2', 1, 0);
    room.handleAttackUnit(client('player1'), { attackerId: z.id, targetId: foe.id });
    expect(errors).toEqual(['黄巾贼不能主动攻击']);
    expect(foe.hp).toBe(2);
  });

  it('起义时作废本回合剩余的攻击权', () => {
    const g = taiping('player1');
    const l = lishi('l1', 'player1', 0, 0);
    expect(l.hasAttacked).toBe(false);
    room.killUnit(g);
    expect(l.hasAttacked).toBe(true);
  });
});

describe('贼的移动与充能', () => {
  it('移动距离 1，每回合最多一次', () => {
    const z = zei('z1', 'player1', 0, 0);
    expect(getValidMoves(U(z), room.unitList)).toHaveLength(6);
    z.hasMoved = true;
    expect(getValidMoves(U(z), room.unitList)).toEqual([]);
  });

  it('耗尽后主动移动一次即充满', () => {
    const z = zei('z1', 'player1', 0, 0, { charged: false });
    room.handleMoveUnit(client('player1'), { unitId: z.id, toQ: 1, toR: 0, toS: -1 });
    expect(errors).toEqual([]);
    expect(z.charged).toBe(true);
  });

  it('充能不消耗额外行动点（就是那一次移动的 1 点）', () => {
    const z = zei('z1', 'player1', 0, 0, { charged: false });
    room.state.player1ActionPoints = 5;
    room.handleMoveUnit(client('player1'), { unitId: z.id, toQ: 1, toR: 0, toS: -1 });
    expect(room.state.player1ActionPoints).toBe(4);
  });

  it('已充满时移动不报重复充能', () => {
    const z = zei('z1', 'player1', 0, 0, { charged: true });
    room.handleMoveUnit(client('player1'), { unitId: z.id, toQ: 1, toR: 0, toS: -1 });
    expect(z.charged).toBe(true);
    expect(room.state.battleLog.filter(l => l.includes('重新积蓄')).length).toBe(0);
  });

  it('充能只在三处被点亮：起义、主动移动、腐化出生', () => {
    // 规则要求「被击退、被动位移等不属于主动移动的效果不会恢复充能」。
    // 目前场上还没有能被动位移贼的效果（纵深抗击的击退链只处理步兵），
    // 所以没法从行为上构造反例 —— 改为钉住赋值点：
    // 多出来的那一处就是一条绕过「主动移动才回充」的路径。
    //
    // 三处分别是：起义转化（力士变贼，天生充满）、
    // handleMoveUnit（主动移动回充）、腐化出生的新贼（规则明确充满）。
    const fs = require('node:fs') as typeof import('node:fs');
    const src = fs.readFileSync(new URL('../rooms/ShiyuanRoom.ts', import.meta.url), 'utf-8');
    const hits = src.split('\n').filter(l => /\.charged = true/.test(l));
    expect(hits).toHaveLength(3);
    expect(src).toContain('if (unit.type === "huangjin_zei" && !unit.charged)');
  });

  it('直接改坐标（模拟被动位移）不会回充', () => {
    const z = zei('z1', 'player1', 0, 0, { charged: false });
    // 击退一类的效果是直接写坐标的，不经过 handleMoveUnit
    z.q = 1; z.r = 0; z.s = -1;
    expect(z.charged).toBe(false);
    // 而主动移动会
    room.handleMoveUnit(client('player1'), { unitId: z.id, toQ: 2, toR: 0, toS: -2 });
    expect(z.charged).toBe(true);
  });

  it('非贼单位移动不会被加上 charged', () => {
    const inf = place('i', 'infantry', 'player1', 0, 0);
    room.handleMoveUnit(client('player1'), { unitId: inf.id, toQ: 1, toR: 0, toS: -1 });
    expect(inf.charged).toBe(false);
  });
});

describe('贼的死亡与夺营', () => {
  it('体力耗尽直接死亡，不转平民', () => {
    const z = zei('z1', 'player1', 1, 0, { hp: 1 });
    const a = place('a', 'infantry', 'player2', 0, 0);
    room.state.currentPlayer = 'player2';
    room.handleAttackUnit(client('player2'), { attackerId: a.id, targetId: z.id });
    expect(room.state.units.has('z1')).toBe(false);
    expect(Array.from(room.state.units.values()).some(u => u.statusTag === CIVILIAN_TAG)).toBe(false);
  });

  it('击杀贼照常给士气奖励（旧规则的「返还 1 AP」已删除）', () => {
    const z = zei('z1', 'player1', 1, 0, { hp: 1 });
    room.rng = () => 0.5; // rollD6 → 4
    expect(room.grantFirstKillReward('player2', z)).toBe(true);
    expect(room.state.player2KilledThisTurn).toBe(true);
    expect(room.state.player2ActionPoints).toBe(24);
  });

  it('贼接触敌方大本营即获胜', () => {
    const z = zei('z1', 'player1', 0, -4);
    room.handleMoveUnit(client('player1'), { unitId: z.id, toQ: 0, toR: -5, toS: 5 });
    expect(errors).toEqual([]);
    expect(room.state.phase).toBe('end');
  });

  it('1 血贼同样可以夺营', () => {
    const z = zei('z1', 'player1', 0, -4, { hp: 1 });
    room.handleMoveUnit(client('player1'), { unitId: z.id, toQ: 0, toR: -5, toS: 5 });
    expect(room.state.phase).toBe('end');
  });
});

describe('§7.2 太平死后的回合', () => {
  function deadTaipingTurn() {
    // player1 选了太平但场上没有太平将军 = 已阵亡
    room.state.player1Taiping.destiny = 8;
    room.state.player1Taiping.fushuiUsedThisTurn = true;
  }

  it('不再结算天命骰', () => {
    deadTaipingTurn();
    room.rng = () => 0; // 若结算则会 −1
    room.settleDestiny('player1');
    expect(room.state.player1Taiping.destiny).toBe(8);
    expect(room.state.player1Taiping.lastHuangtian).toBe(0);
  });

  it('不再有天命承载判定（没有太平可掉血）', () => {
    deadTaipingTurn();
    for (let i = 0; i < 7; i++) zei(`z${i}`, 'player1', i - 3, 0);
    room.rng = () => 0.5;
    expect(() => room.settleDestiny('player1')).not.toThrow();
  });

  it('不再有豆饭征募阶段', () => {
    deadTaipingTurn();
    place('src', 'infantry', 'player1', 0, 0);
    place('c1', 'neutral_marker', 'neutral', 1, 0, { hp: 1, maxHp: 1, statusTag: CIVILIAN_TAG });
    room.startDoufanPhase('player1');
    expect(room.state.player1Taiping.pendingRecruit.length).toBe(0);
  });

  it('平民刷新改为固定 1 名', () => {
    deadTaipingTurn();
    room.state.player1Taiping.destiny = 12; // 存活时本该刷 3
    room.refreshCivilians('player1');
    expect(Array.from(room.state.units.values()).filter(u => u.statusTag === CIVILIAN_TAG)).toHaveLength(1);
  });

  it('掷骰少一颗基础骰（将军阵亡的既有规则）', () => {
    deadTaipingTurn();
    room.rollDiceForPlayer('player1');
    // 基础 0 + 部署 4/2 = 2 颗
    expect(room.state.player1Dice).toBe(2);
  });

  it('太平存活时是 3 颗（对照）', () => {
    taiping('player1');
    room.rollDiceForPlayer('player1');
    expect(room.state.player1Dice).toBe(3);
  });
});
