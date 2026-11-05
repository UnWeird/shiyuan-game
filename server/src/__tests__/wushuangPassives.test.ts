import { beforeEach, describe, expect, it } from 'vitest';
import { ShiyuanRoom } from '../rooms/ShiyuanRoom';
import { GameStateSchema, UnitSchema } from '../schema/GameState';
import { Direction } from '../../../shared/types';
import { getBiyiForbiddenHexes, getValidMoves, occupiedHexesOf, type UnitLike } from '../../../shared/rules/queries';
import { hexDistance } from '../../../shared/utils/hexUtils';

/**
 * 无双 · 两个被动：踏阵 与 辟易
 *
 * 这一组盯的是第一版实现踩的三个坑，每一个都单独成例：
 *
 * 1. **踏阵发给了被杀方。** `recordWushuangTacticsKill` 算出 defendingRole
 *    再去找那一方的无双 —— 玩家1 杀人，玩家2 的无双白拿一次位移。
 * 2. **踏阵落点不校验。** 只查了「在图内 + 没被占」，从不比对候选列表，
 *    于是任意空格都能踏 —— 一个纯服务端的无限传送漏洞。
 * 3. **辟易整段是死代码。** 它被追加在 `return possibleMoves.filter(...)`
 *    之后，永远不执行。而不可达代码让 TS 的收窄失效、报出
 *    「enemyWushuang possibly undefined」，第一版用 `!` 把这个唯一的
 *    信号压掉了。所以这里必须有「禁区真的生效」的正面断言。
 *
 * 另外补两条第一版没想到的：辟易要盖住骑兵和机关（底层函数有 6 个出口，
 * 写在末尾只盖得住步兵/弓箭手/将领那一条），机关要按整个车身判。
 */

type RoomProbe = {
  state: GameStateSchema;
  setState: (s: GameStateSchema) => void;
  unitList: UnitLike[];
  getPlayerRole: (c: unknown) => 'player1' | 'player2' | null;
  registerMessageHandlers: () => void;
  onMessageHandlers: Record<string, { callback: (c: unknown, d: unknown) => void }>;
  getValidMoves: (u: UnitSchema) => { q: number; r: number; s: number }[];
  performFanAttack: (g: UnitSchema, attacker: 'player1' | 'player2', dir: number) => void;
  killUnit: (u: UnitSchema) => void;
  handleEndTurn: (c: unknown) => void;
};

let room: RoomProbe;
let errors: string[];

const client = (role: 'player1' | 'player2') => ({
  sessionId: role,
  send: (type: string, data: { message?: string }) => {
    if (type === 'error') errors.push(data.message ?? '');
  },
});

function send(role: 'player1' | 'player2', type: string, data: unknown = {}) {
  room.onMessageHandlers[type]!.callback(client(role), data);
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

const unit = (id: string) => room.state.units.get(id);

/** 放一个无双将军 */
function wushuang(role: 'player1' | 'player2', q = 0, r = 0) {
  return place(`g_${role}`, 'general', role, q, r, { generalType: 'wushuang', hp: 4, maxHp: 4 });
}

const tactics = () => ({
  active: room.state.wushuangTacticsActive,
  player: room.state.wushuangTacticsPlayer,
  hexes: Array.from(room.state.wushuangTacticsKillHexes),
});

/** 某个落点是否在该单位的合法移动集合里 */
function canMoveTo(u: UnitSchema, q: number, r: number): boolean {
  return getValidMoves(u as unknown as UnitLike, room.unitList)
    .some(m => m.q === q && m.r === r);
}

beforeEach(() => {
  errors = [];
  room = new ShiyuanRoom() as unknown as RoomProbe;
  room.setState(new GameStateSchema());
  room.state.phase = 'action';
  room.state.currentPlayer = 'player1';
  room.state.player1General = 'wushuang';
  room.state.player2General = 'wushuang';
  room.state.player1ActionPoints = 20;
  room.state.player2ActionPoints = 20;
  room.state.player1BaseQ = 0; room.state.player1BaseR = 5; room.state.player1BaseS = -5;
  room.state.player2BaseQ = 0; room.state.player2BaseR = -5; room.state.player2BaseS = 5;
  room.getPlayerRole = (c: unknown) => (c as { sessionId: string }).sessionId as 'player1' | 'player2';
  room.registerMessageHandlers();
});

describe('踏阵 · 归属', () => {
  it('机会归击杀方，不归被杀方', () => {
    const g = wushuang('player1', 0, 0);
    // 正东相邻，1 血，必被扇形一刀带走
    place('e1', 'infantry', 'player2', 1, 0, { hp: 1 });
    wushuang('player2', 0, -4); // 被杀方也有无双，用来暴露归属写反

    room.performFanAttack(g, 'player1', Direction.EAST);

    expect(unit('e1')).toBeUndefined();          // 真的杀掉了
    expect(tactics().active).toBe(true);
    expect(tactics().player).toBe('player1');    // ← 第一版这里是 player2
    expect(tactics().hexes).toEqual(['1,0,-1']);
  });

  it('击杀方没有无双时不开踏阵', () => {
    const g = place('mach', 'general', 'player1', 0, 0, { generalType: 'shenji', hp: 3, maxHp: 3 });
    place('e1', 'infantry', 'player2', 1, 0, { hp: 1 });
    // 用无双的扇形函数但执行者不是无双 —— offer 应当认人不认刀
    room.performFanAttack(g, 'player1', Direction.EAST);
    expect(unit('e1')).toBeUndefined();
    expect(tactics().active).toBe(false);
  });

  it('平民与中立标记的击杀不开踏阵', () => {
    const g = wushuang('player1', 0, 0);
    place('civ', 'neutral_marker', 'neutral', 1, 0, { hp: 1, statusTag: 'civilian' });
    place('mk', 'neutral_marker', 'neutral', 1, -1, { hp: 1 });

    room.performFanAttack(g, 'player1', Direction.EAST);

    expect(tactics().active).toBe(false);
    expect(tactics().hexes).toEqual([]);
  });
});

describe('踏阵 · 落点校验（传送漏洞）', () => {
  beforeEach(() => {
    const g = wushuang('player1', 0, 0);
    place('e1', 'infantry', 'player2', 1, 0, { hp: 1 });
    room.performFanAttack(g, 'player1', Direction.EAST);
  });

  it('不在候选列表里的空格一律拒绝', () => {
    send('player1', 'wushuangTactics', { tacticHex: { q: 4, r: -2, s: -2 } });

    expect(errors).toContain('踏阵只能踏向本次击杀腾出的空位');
    expect(unit('g_player1')!.q).toBe(0);   // 没动
    expect(unit('g_player1')!.r).toBe(0);
    expect(tactics().active).toBe(true);    // 机会还在
  });

  it('候选格可以踏，且踏完机会关闭', () => {
    send('player1', 'wushuangTactics', { tacticHex: { q: 1, r: 0, s: -1 } });

    expect(errors).toEqual([]);
    expect(unit('g_player1')!.q).toBe(1);
    expect(unit('g_player1')!.r).toBe(0);
    expect(tactics().active).toBe(false);
    expect(tactics().hexes).toEqual([]);
  });

  it('候选格被连带效果填回去了就拒绝，并摘掉该候选', () => {
    place('filler', 'infantry', 'player1', 1, 0);   // 占住尸位

    send('player1', 'wushuangTactics', { tacticHex: { q: 1, r: 0, s: -1 } });

    expect(errors).toContain('踏阵目标已被占据');
    expect(unit('g_player1')!.q).toBe(0);
    expect(tactics().active).toBe(false);           // 唯一候选废了，整体关闭
  });

  it('非机会所有者发消息被拒', () => {
    send('player2', 'wushuangTactics', { tacticHex: { q: 1, r: 0, s: -1 } });
    expect(errors).toContain('此刻没有属于你的踏阵机会');
    expect(unit('g_player1')!.q).toBe(0);
  });

  it('放弃踏阵：不动，机会关闭', () => {
    send('player1', 'wushuangTactics', { tacticHex: null });
    expect(errors).toEqual([]);
    expect(unit('g_player1')!.q).toBe(0);
    expect(tactics().active).toBe(false);
  });
});

describe('踏阵 · 多杀与过期', () => {
  it('一刀多杀：候选是全部尸位，但只能择一', () => {
    const g = wushuang('player1', 0, 0);
    // 东向扇形覆盖的三格，各放一个 1 血敌人
    place('e1', 'infantry', 'player2', 1, 0, { hp: 1 });
    place('e2', 'infantry', 'player2', 1, -1, { hp: 1 });

    room.performFanAttack(g, 'player1', Direction.EAST);

    const hexes = tactics().hexes;
    expect(hexes.length).toBeGreaterThanOrEqual(2);

    send('player1', 'wushuangTactics', { tacticHex: { q: 1, r: -1, s: 0 } });
    expect(unit('g_player1')!.r).toBe(-1);
    expect(tactics().active).toBe(false);   // 择一即结束，不能接着踏第二个
  });

  it('下一段扇形开打时，上一段未决的踏阵作废', () => {
    const g = wushuang('player1', 0, 0);
    place('e1', 'infantry', 'player2', 1, 0, { hp: 1 });
    room.performFanAttack(g, 'player1', Direction.EAST);
    expect(tactics().hexes).toEqual(['1,0,-1']);

    // 第二段：换个方向，没杀到人
    room.performFanAttack(g, 'player1', Direction.WEST);
    expect(tactics().active).toBe(false);
    expect(tactics().hexes).toEqual([]);
  });

  it('回合结束时未决的踏阵作废（不能攒到下回合）', () => {
    const g = wushuang('player1', 0, 0);
    place('e1', 'infantry', 'player2', 1, 0, { hp: 1 });
    room.performFanAttack(g, 'player1', Direction.EAST);
    expect(tactics().active).toBe(true);

    room.handleEndTurn(client('player1'));

    expect(tactics().active).toBe(false);
    expect(tactics().player).toBe('');
  });

  it('无双阵亡时未决的踏阵作废', () => {
    const g = wushuang('player1', 0, 0);
    place('e1', 'infantry', 'player2', 1, 0, { hp: 1 });
    room.performFanAttack(g, 'player1', Direction.EAST);
    expect(tactics().active).toBe(true);

    room.killUnit(unit('g_player1')!);

    expect(tactics().active).toBe(false);
  });

  it('不是自己的回合不能踏', () => {
    const g = wushuang('player1', 0, 0);
    place('e1', 'infantry', 'player2', 1, 0, { hp: 1 });
    room.performFanAttack(g, 'player1', Direction.EAST);

    room.state.currentPlayer = 'player2';
    send('player1', 'wushuangTactics', { tacticHex: { q: 1, r: 0, s: -1 } });

    expect(errors).toContain('不是你的回合');
    expect(unit('g_player1')!.q).toBe(0);
  });
});

describe('辟易 · 禁区真的生效', () => {
  it('步兵无法走进敌方无双的相邻 6 格', () => {
    wushuang('player2', 0, 0);
    const inf = place('i1', 'infantry', 'player1', 0, 3);

    const moves = getValidMoves(inf as unknown as UnitLike, room.unitList);
    expect(moves.length).toBeGreaterThan(0);               // 它还能动
    for (const m of moves) {
      expect(hexDistance(m, { q: 0, r: 0, s: 0 })).toBeGreaterThan(1);
    }
  });

  it('没有敌方无双时禁区不存在（对照组）', () => {
    place('g_player2', 'general', 'player2', 0, 0, { generalType: 'rende', hp: 4, maxHp: 4 });
    const inf = place('i1', 'infantry', 'player1', 0, 2);

    // 仁德在 (0,0)，(0,1) 与它相邻 —— 没有辟易就该走得进去
    expect(canMoveTo(inf, 0, 1)).toBe(true);
  });

  it('已相邻的单位可以留下，也可以走开，但不能在禁区里换格', () => {
    wushuang('player2', 0, 0);
    const inf = place('i1', 'infantry', 'player1', 0, 1);   // 已贴脸

    const moves = getValidMoves(inf as unknown as UnitLike, room.unitList);
    // 走开是允许的
    expect(moves.length).toBeGreaterThan(0);
    // 但没有一个落点还在禁区里（换一格贴脸不行）
    for (const m of moves) {
      expect(hexDistance(m, { q: 0, r: 0, s: 0 })).toBeGreaterThan(1);
    }
  });

  it('自己的无双不限制自己人', () => {
    wushuang('player1', 0, 0);
    const inf = place('i1', 'infantry', 'player1', 0, 2);
    expect(canMoveTo(inf, 0, 1)).toBe(true);
  });

  it('中立单位不受辟易约束', () => {
    wushuang('player1', 0, 0);
    wushuang('player2', 0, -4);
    const civ = place('civ', 'neutral_marker', 'neutral', 0, 2, { statusTag: 'civilian', hp: 1 });

    // 中立眼里两个无双都是「敌方」，第一版会按创建顺序随机挑一个来禁。
    // 正确行为是完全不生效 —— 平民能走到任一无双身边。
    const moves = getValidMoves(civ as unknown as UnitLike, room.unitList);
    if (moves.length > 0) {
      expect(moves.some(m => hexDistance(m, { q: 0, r: 0, s: 0 }) <= 1)).toBe(true);
    }
  });
});

describe('辟易 · 禁区可视化下发', () => {
  it('禁区 = 敌方无双的相邻 6 格，不含它自己站的那一格', () => {
    wushuang('player2', 0, 0);

    const zone = getBiyiForbiddenHexes('player1', room.unitList);
    expect(zone).toHaveLength(6);
    for (const h of zone) {
      expect(hexDistance(h, { q: 0, r: 0, s: 0 })).toBe(1);
    }
    // 无双自己那格进不去是因为「有人占着」，不是辟易 —— 混在一起画会让玩家以为是 7 格
    expect(zone.some(h => h.q === 0 && h.r === 0)).toBe(false);
  });

  it('贴边时只报在图内的那几格', () => {
    wushuang('player2', 0, -5);   // 顶边
    const zone = getBiyiForbiddenHexes('player1', room.unitList);
    expect(zone.length).toBeGreaterThan(0);
    expect(zone.length).toBeLessThan(6);
  });

  it('禁区只画给对手，无双自己那方拿到空', () => {
    wushuang('player2', 0, 0);
    expect(getBiyiForbiddenHexes('player1', room.unitList)).toHaveLength(6);
    expect(getBiyiForbiddenHexes('player2', room.unitList)).toHaveLength(0);
  });

  it('没有无双 / 中立方：空数组', () => {
    place('g', 'general', 'player2', 0, 0, { generalType: 'rende' });
    expect(getBiyiForbiddenHexes('player1', room.unitList)).toHaveLength(0);
    wushuang('player2', 2, 0);
    expect(getBiyiForbiddenHexes('neutral', room.unitList)).toHaveLength(0);
  });

  it('禁区和实际禁掉的落点口径一致', () => {
    wushuang('player2', 0, 0);
    const inf = place('i1', 'infantry', 'player1', 0, 2);

    const zone = getBiyiForbiddenHexes('player1', room.unitList)
      .map(h => `${h.q},${h.r}`);
    const moves = getValidMoves(inf as unknown as UnitLike, room.unitList)
      .map(m => `${m.q},${m.r}`);

    // 画出来的禁格，一个都不该出现在合法落点里
    for (const k of zone) expect(moves).not.toContain(k);
    // 而 (0,1) 既该被画成禁格、也该不在落点里（若两者脱钩这条会挂）
    expect(zone).toContain('0,1');
  });
});

describe('辟易 · 覆盖所有兵种出口', () => {
  it('骑兵也受辟易约束（底层走的是另一个 return）', () => {
    wushuang('player2', 0, 0);
    const cav = place('c1', 'cavalry', 'player1', 0, 4);

    const moves = getValidMoves(cav as unknown as UnitLike, room.unitList);
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) {
      expect(hexDistance(m, { q: 0, r: 0, s: 0 })).toBeGreaterThan(1);
    }
  });

  it('机关按整个车身判：半个车身贴脸也不行', () => {
    wushuang('player2', 0, 0);
    const ch = place('ch1', 'chariot', 'player1', 0, 4, {
      hp: 4, maxHp: 4, deployedBy: 'player1',
    });

    const moves = getValidMoves(ch as unknown as UnitLike, room.unitList);
    for (const m of moves) {
      const body = occupiedHexesOf({
        ...(ch as unknown as UnitLike),
        q: m.q, r: m.r, s: m.s,
      });
      for (const h of body) {
        expect(hexDistance(h, { q: 0, r: 0, s: 0 })).toBeGreaterThan(1);
      }
    }
  });
});
