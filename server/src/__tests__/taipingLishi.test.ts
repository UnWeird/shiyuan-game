import { beforeEach, describe, expect, it } from 'vitest';
import { ShiyuanRoom } from '../rooms/ShiyuanRoom';
import { GameStateSchema, UnitSchema } from '../schema/GameState';
import {
  CIVILIAN_CAP,
  CIVILIAN_TAG,
  checkAttackLegality,
  countCivilians,
  countLishi,
  getAttackableTargets,
  getValidMoves,
  isCivilian,
  type UnitLike,
} from '../../../shared/rules/queries';

/**
 * 太平 · 黄巾力士（信仰不死）
 *
 * 力士用「残血不能攻击」换「不会真的死」：
 *   2 血 → 正常；1 血 → 只能移动；0 血 → 化为 1 血中立平民。
 *
 * 实现上最关键的一点是**转化拦在 killUnit 里**，而不是在每条伤害路径上各写一遍
 * —— 普通攻击、机关溅射、战车碾压、无双扇形走的都是那个出口。
 */

type RoomProbe = {
  state: GameStateSchema;
  setState: (s: GameStateSchema) => void;
  rng: () => number;
  unitList: UnitLike[];
  killUnit: (u: UnitSchema) => void;
  refreshCivilians: (role: 'player1' | 'player2') => void;
  handleAttackUnit: (c: unknown, d: { attackerId: string; targetId: string }) => void;
  handleMoveUnit: (c: unknown, d: { unitId: string; toQ: number; toR: number; toS: number }) => void;
  getPlayerRole: (c: unknown) => 'player1' | 'player2' | null;
};

let room: RoomProbe;
const errors: string[] = [];
const sent: Array<{ type: string; data: unknown }> = [];

const client = (role: 'player1' | 'player2') => ({
  sessionId: role,
  send: (type: string, data: { message?: string }) => {
    sent.push({ type, data });
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

const lishi = (id: string, owner: 'player1' | 'player2', q: number, r: number, hp = 2) =>
  place(id, 'huangjin_lishi', owner, q, r, { hp, maxHp: 2 });

const civ = (id: string, q: number, r: number) =>
  place(id, 'neutral_marker', 'neutral', q, r, { hp: 1, maxHp: 1, statusTag: CIVILIAN_TAG });

const taiping = (role: 'player1' | 'player2' = 'player1', q = 0, r = 4) =>
  place(`g_${role}`, 'general', role, q, r, { generalType: 'taiping', hp: 3, maxHp: 3 });

const U = (u: UnitSchema) => u as unknown as UnitLike;

/** 场上所有公共平民 */
const civilians = () =>
  Array.from(room.state.units.values()).filter(u => isCivilian(U(u)));

beforeEach(() => {
  errors.length = 0;
  sent.length = 0;
  room = newGame();
});

describe('基础属性', () => {
  it('移动距离 1（和普通步兵一样）', () => {
    const l = lishi('l1', 'player1', 0, 0);
    const moves = getValidMoves(U(l), room.unitList);
    expect(moves).toHaveLength(6);
    for (const m of moves) {
      expect(Math.max(Math.abs(m.q), Math.abs(m.r), Math.abs(-m.q - m.r))).toBeLessThanOrEqual(1);
    }
  });

  it('近战射程 1 —— 隔一格就打不到', () => {
    // 这条是在修一个真实的坑：力士原先不在近战名单里，
    // 会落进「没有任何射程判定」的分支，能隔着整张棋盘打对角
    const l = lishi('l1', 'player1', 0, 0);
    const near = place('n', 'infantry', 'player2', 1, 0);
    const far = place('f', 'infantry', 'player2', 3, 0);
    const across = place('x', 'infantry', 'player2', -5, 0);
    expect(checkAttackLegality(U(l), U(near), room.unitList).ok).toBe(true);
    expect(checkAttackLegality(U(l), U(far), room.unitList).ok).toBe(false);
    expect(checkAttackLegality(U(l), U(across), room.unitList).ok).toBe(false);
    expect(getAttackableTargets(U(l), room.unitList)).toEqual(['n']);
  });
});

describe('信仰不死：1 血的限制', () => {
  it('2 血力士能正常攻击', () => {
    const l = lishi('l1', 'player1', 0, 0, 2);
    place('n', 'infantry', 'player2', 1, 0);
    expect(getAttackableTargets(U(l), room.unitList)).toEqual(['n']);
  });

  it('1 血力士不能主动攻击', () => {
    const l = lishi('l1', 'player1', 0, 0, 1);
    const n = place('n', 'infantry', 'player2', 1, 0);
    const res = checkAttackLegality(U(l), U(n), room.unitList);
    expect(res.ok).toBe(false);
    expect(getAttackableTargets(U(l), room.unitList)).toEqual([]);
  });

  it('1 血力士仍然可以移动', () => {
    const l = lishi('l1', 'player1', 0, 0, 1);
    expect(getValidMoves(U(l), room.unitList).length).toBeGreaterThan(0);
  });

  it('端到端：1 血力士发起攻击被服务端拒绝', () => {
    const l = lishi('l1', 'player1', 0, 0, 1);
    const n = place('n', 'infantry', 'player2', 1, 0);
    room.handleAttackUnit(client('player1'), { attackerId: l.id, targetId: n.id });
    expect(errors).toEqual(['残血的黄巾力士无法主动攻击']);
    expect(n.hp).toBe(2);
  });
});

describe('力士不能攻击平民', () => {
  it('2 血力士也打不到平民', () => {
    taiping('player1');
    const l = lishi('l1', 'player1', 0, 0, 2);
    const c = civ('c1', 1, 0);
    expect(checkAttackLegality(U(l), U(c), room.unitList).ok).toBe(false);
    expect(getAttackableTargets(U(l), room.unitList)).not.toContain('c1');
  });

  it('太平阵亡后力士依然打不到平民（这条不看太平是否存活）', () => {
    // 场上没有太平将军 → 正规军可以打平民，但力士仍然不行
    const l = lishi('l1', 'player1', 0, 0, 2);
    const inf = place('i', 'infantry', 'player1', 2, 0);
    const c = civ('c1', 1, 0);
    expect(checkAttackLegality(U(inf), U(c), room.unitList).ok).toBe(true);
    const res = checkAttackLegality(U(l), U(c), room.unitList);
    expect(res.ok).toBe(false);
    expect((res as { reason: string }).reason).toBe('黄巾力士不能攻击平民');
  });
});

describe('信仰不死：0 血化为平民', () => {
  it('原格出现 1 血平民，力士从场上消失', () => {
    const l = lishi('l1', 'player1', 2, 0);
    room.killUnit(l);
    expect(room.state.units.has('l1')).toBe(false);
    const cs = civilians();
    expect(cs).toHaveLength(1);
    expect({ q: cs[0]!.q, r: cs[0]!.r }).toEqual({ q: 2, r: 0 });
    expect(cs[0]!.hp).toBe(1);
    expect(cs[0]!.owner).toBe('neutral');
  });

  it('新平民带 civilian 标记，之后能被符水粥 / 豆饭认出来', () => {
    room.killUnit(lishi('l1', 'player1', 2, 0));
    expect(civilians()[0]!.statusTag).toBe(CIVILIAN_TAG);
  });

  it('转化立刻释放承载量', () => {
    lishi('l1', 'player1', 1, 0);
    lishi('l2', 'player1', 2, 0);
    expect(countLishi(room.unitList, 'player1')).toBe(2);
    room.killUnit(room.state.units.get('l1')!);
    expect(countLishi(room.unitList, 'player1')).toBe(1);
  });

  it('不是击杀：不给士气奖励', () => {
    const l = lishi('l1', 'player1', 1, 0);
    const a = place('a', 'infantry', 'player2', 0, 0);
    room.state.currentPlayer = 'player2';
    l.hp = 1; // 一下打死

    room.handleAttackUnit(client('player2'), { attackerId: a.id, targetId: l.id });

    expect(errors).toEqual([]);
    expect(room.state.units.has('l1')).toBe(false);
    expect(civilians()).toHaveLength(1);
    expect(room.state.player2KilledThisTurn).toBe(false);
  });

  it('也不扣太平的天命（力士转平民不算平民死亡）', () => {
    taiping('player1');
    room.state.player1Taiping.destiny = 7;
    room.killUnit(lishi('l1', 'player1', 1, 0));
    expect(room.state.player1Taiping.destiny).toBe(7);
  });

  it('端到端：2 血力士挨两刀才化为平民', () => {
    const l = lishi('l1', 'player1', 1, 0, 2);
    const a = place('a', 'infantry', 'player2', 0, 0);
    room.state.currentPlayer = 'player2';

    room.handleAttackUnit(client('player2'), { attackerId: a.id, targetId: l.id });
    expect(room.state.units.has('l1')).toBe(true);
    expect(l.hp).toBe(1);
    expect(civilians()).toHaveLength(0);

    // 换一个攻击者，因为 a 本回合已攻击过
    const b = place('b', 'infantry', 'player2', 2, 0);
    room.handleAttackUnit(client('player2'), { attackerId: b.id, targetId: l.id });
    expect(room.state.units.has('l1')).toBe(false);
    expect(civilians()).toHaveLength(1);
  });

  it('仁德打死力士不弹击杀确认 —— 信仰不死直接生效', () => {
    room = newGame('taiping', 'rende');
    place('gr', 'general', 'player2', 0, -4, { generalType: 'rende', hp: 4, maxHp: 4 });
    const l = lishi('l1', 'player1', 1, 0, 1);
    const a = place('a', 'infantry', 'player2', 0, 0);
    room.state.currentPlayer = 'player2';

    room.handleAttackUnit(client('player2'), { attackerId: a.id, targetId: l.id });

    expect(sent.filter(s => s.type === 'rendeKillConfirm')).toHaveLength(0);
    expect(room.state.units.has('l1')).toBe(false);
    expect(civilians()).toHaveLength(1);
    expect(civilians()[0]!.statusTag).toBe(CIVILIAN_TAG);
  });
});

describe('转化来的平民与刷新上限', () => {
  it('不受 5 名上限限制 —— 可以超过 5', () => {
    for (let i = 0; i < CIVILIAN_CAP; i++) civ(`c${i}`, i - 2, 0);
    expect(countCivilians(room.unitList)).toBe(CIVILIAN_CAP);

    room.killUnit(lishi('l1', 'player1', 0, 2));
    expect(countCivilians(room.unitList)).toBe(CIVILIAN_CAP + 1);
  });

  it('但计入总数，会挤掉之后的自动刷新', () => {
    taiping('player1');
    room.state.player1Taiping.destiny = 12; // 本应刷 3
    for (let i = 0; i < 4; i++) civ(`c${i}`, i - 2, 0);
    room.killUnit(lishi('l1', 'player1', 0, 2)); // 第 5 个平民来自转化

    room.refreshCivilians('player1');
    expect(countCivilians(room.unitList)).toBe(5);
  });
});

describe('夺营', () => {
  it('力士接触敌方大本营即获胜', () => {
    const l = lishi('l1', 'player1', 0, -4, 2);
    room.handleMoveUnit(client('player1'), { unitId: l.id, toQ: 0, toR: -5, toS: 5 });
    expect(errors).toEqual([]);
    expect(room.state.phase).toBe('end');
    expect(room.state.battleLog.some(l => l.includes('触碰到敌方大本营'))).toBe(true);
  });

  it('1 血力士同样可以夺营', () => {
    const l = lishi('l1', 'player1', 0, -4, 1);
    room.handleMoveUnit(client('player1'), { unitId: l.id, toQ: 0, toR: -5, toS: 5 });
    expect(room.state.phase).toBe('end');
  });

  it('走到别处不会误判胜利', () => {
    const l = lishi('l1', 'player1', 0, -4, 2);
    room.handleMoveUnit(client('player1'), { unitId: l.id, toQ: 1, toR: -4, toS: 3 });
    expect(room.state.phase).toBe('action');
  });
});

describe('死亡出口的收口', () => {
  it('裸 units.delete 的处数保持在已知范围内', () => {
    // 力士转平民、平民扣天命、太平阵亡这三条规则都挂在 killUnit 上。
    // 新加一条能打死单位的路径却用裸 delete，这些规则会静默失效 ——
    // 所以把处数钉住，迫使下一个人做一次有意识的选择：
    // 是死亡（走 killUnit），还是转化（可以裸 delete）。
    const fs = require('node:fs') as typeof import('node:fs');
    const src = fs.readFileSync(new URL('../rooms/ShiyuanRoom.ts', import.meta.url), 'utf-8');
    const count = (src.match(/this\.state\.units\.delete\(/g) ?? []).length;
    // 分类：1 处是 killUnit 自己的出口；4 处是**转化**（力士化为平民、
    // 符水粥救济、豆饭征募平民为力士、腐化平民为黄巾贼）—— 转化不是死亡，
    // 就该用裸 delete；其余是仁德招降 / 以德服人 / 机关崩解等转化，
    // 或打不到平民的死亡路径。
    //
    // 这个数字变了不等于有 bug，但必须有人看一眼：新增的那处是死亡（走 killUnit）
    // 还是转化（可以裸 delete）。
    expect(count).toBe(16);
  });
});
