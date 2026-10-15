import { beforeEach, describe, expect, it } from 'vitest';
import { ShiyuanRoom } from '../rooms/ShiyuanRoom';
import { GameStateSchema, UnitSchema } from '../schema/GameState';
import {
  CIVILIAN_TAG,
  HUANGTIAN_DESTINY,
  getHuangtianConditions,
  huangtianStillHolds,
  type UnitLike,
} from '../../../shared/rules/queries';

/**
 * 太平 · 黄天当立（特殊胜利）
 *
 * 四条件宣告 → 对手一个完整回合反制 → 条件仍成立则下回合开始取胜。
 *
 * 时序是最容易写错的部分：player1 和 player2 的「一个完整回合」长度不同
 * （turn 只在切回 player1 时 ++），所以两边各有一组时序测试。
 */

type RoomProbe = {
  state: GameStateSchema;
  setState: (s: GameStateSchema) => void;
  rng: () => number;
  unitList: UnitLike[];
  settleDestiny: (role: 'player1' | 'player2') => void;
  rollDiceForPlayer: (role: 'player1' | 'player2') => void;
  handleEndTurn: (c: unknown) => void;
  killUnit: (u: UnitSchema) => void;
  buildValidActions: () => { huangtian: null | Record<string, unknown> };
  getPlayerRole: (c: unknown) => 'player1' | 'player2' | null;
  registerMessageHandlers: () => void;
  onMessageHandlers: Record<string, { callback: (c: unknown, d: unknown) => void }>;
};

let room: RoomProbe;
const errors: string[] = [];

const client = (role: 'player1' | 'player2') => ({
  sessionId: role,
  send: (type: string, data: { message?: string }) => {
    if (type === 'error') errors.push(data.message ?? '');
  },
});

function send(role: 'player1' | 'player2', type: string, data: unknown = {}) {
  room.onMessageHandlers[type]!.callback(client(role), data);
}

function newGame(p1 = 'taiping', p2 = 'wushuang'): RoomProbe {
  const r = new ShiyuanRoom() as unknown as RoomProbe;
  r.setState(new GameStateSchema());
  r.state.phase = 'action';
  r.state.currentPlayer = 'player1';
  r.state.turn = 1;
  r.state.player1General = p1;
  r.state.player2General = p2;
  r.state.player1ActionPoints = 20;
  r.state.player2ActionPoints = 20;
  r.state.player1DeployedValue = 4;
  r.state.player2DeployedValue = 4;
  r.state.player1BaseQ = 0; r.state.player1BaseR = 5; r.state.player1BaseS = -5;
  r.state.player2BaseQ = 0; r.state.player2BaseR = -5; r.state.player2BaseS = 5;
  r.getPlayerRole = (c: unknown) => (c as { sessionId: string }).sessionId as 'player1' | 'player2';
  r.registerMessageHandlers();
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

/** 太平放在交战区（r=0），满足条件 2 */
const taiping = (role: 'player1' | 'player2' = 'player1', q = 0, r = 0) =>
  place(`g_${role}`, 'general', role, q, r, { generalType: 'taiping', hp: 3, maxHp: 3 });

const lishi = (id: string, owner: 'player1' | 'player2', q: number, r: number) =>
  place(id, 'huangjin_lishi', owner, q, r, { hp: 2, maxHp: 2 });

/** 让骰子投出相等的点数（天命不变），避免结算把条件打掉 */
const steadyDice = () => () => 0.5;

/**
 * 把 role 布置成「四条件全满足」的局面。
 * 刻意不放任何会被强制豆饭征募的平民，否则回合结束会被拦。
 */
function readyToDeclare(role: 'player1' | 'player2' = 'player1', q = 0, r = 0) {
  const g = taiping(role, q, r);
  const tp = role === 'player1' ? room.state.player1Taiping : room.state.player2Taiping;
  tp.destiny = 10;
  tp.fushuiUsedThisTurn = true;
  room.rng = steadyDice();
  return g;
}

const tpOf = (role: 'player1' | 'player2') =>
  role === 'player1' ? room.state.player1Taiping : room.state.player2Taiping;

beforeEach(() => {
  errors.length = 0;
  room = newGame();
});

describe('条件清单（纯函数）', () => {
  it('四条全满足时 ok', () => {
    const g = taiping('player1', 0, 0);
    const c = getHuangtianConditions(g as unknown as UnitLike, room.unitList, 10, true);
    expect(c).toEqual({
      destinyEnough: true, inBattleZone: true,
      fushuiUsed: true, withinCapacity: true, ok: true,
    });
  });

  it('天命 9 不够，10 刚好够', () => {
    const g = taiping('player1', 0, 0);
    const U = g as unknown as UnitLike;
    expect(getHuangtianConditions(U, room.unitList, 9, true).destinyEnough).toBe(false);
    expect(getHuangtianConditions(U, room.unitList, 10, true).destinyEnough).toBe(true);
    expect(HUANGTIAN_DESTINY).toBe(10);
  });

  it('太平在起始区则条件 2 不成立', () => {
    const g = taiping('player1', 0, 3); // r=3 已是起始区
    const c = getHuangtianConditions(g as unknown as UnitLike, room.unitList, 12, true);
    expect(c.inBattleZone).toBe(false);
    expect(c.ok).toBe(false);
  });

  it('交战区边界：r=±2 算，r=±3 不算', () => {
    for (const r of [-2, 0, 2]) {
      const g = taiping('player1', 0, r);
      expect(getHuangtianConditions(g as unknown as UnitLike, room.unitList, 12, true).inBattleZone).toBe(true);
      room.state.units.delete(g.id);
    }
    for (const r of [-3, 3]) {
      const g = taiping('player1', 0, r);
      expect(getHuangtianConditions(g as unknown as UnitLike, room.unitList, 12, true).inBattleZone).toBe(false);
      room.state.units.delete(g.id);
    }
  });

  it('本回合没用符水粥则条件 3 不成立', () => {
    const g = taiping('player1', 0, 0);
    expect(getHuangtianConditions(g as unknown as UnitLike, room.unitList, 12, false).fushuiUsed).toBe(false);
  });

  it('力士超出承载则条件 4 不成立', () => {
    const g = taiping('player1', 0, 0);
    for (let i = 0; i < 7; i++) lishi(`l${i}`, 'player1', i - 3, 1); // 天命 10 承载 6
    const c = getHuangtianConditions(g as unknown as UnitLike, room.unitList, 10, true);
    expect(c.withinCapacity).toBe(false);
    expect(c.ok).toBe(false);
  });

  it('只数己方力士', () => {
    const g = taiping('player1', 0, 0);
    for (let i = 0; i < 7; i++) lishi(`l${i}`, 'player2', i - 3, 1);
    expect(getHuangtianConditions(g as unknown as UnitLike, room.unitList, 10, true).withinCapacity).toBe(true);
  });

  it('太平阵亡（general 为 undefined）时四条全不成立', () => {
    const c = getHuangtianConditions(undefined, room.unitList, 12, true);
    expect(c.ok).toBe(false);
    expect(c.destinyEnough).toBe(false);
  });

  it('持续成立的三条不含符水粥', () => {
    const base = { destinyEnough: true, inBattleZone: true, withinCapacity: true, ok: false };
    expect(huangtianStillHolds({ ...base, fushuiUsed: false })).toBe(true);
    expect(huangtianStillHolds({ ...base, fushuiUsed: true, destinyEnough: false })).toBe(false);
  });
});

describe('宣告', () => {
  it('四条件满足时可以宣告，记下当前回合数', () => {
    readyToDeclare('player1');
    send('player1', 'taipingDeclareHuangtian');
    expect(errors).toEqual([]);
    expect(tpOf('player1').huangtianDeclaredTurn).toBe(1);
    expect(room.state.battleLog.some(l => l.includes('黄天当立'))).toBe(true);
  });

  it('条件不足时拒绝，并说清缺哪条', () => {
    taiping('player1', 0, 0);
    room.state.player1Taiping.destiny = 7;
    send('player1', 'taipingDeclareHuangtian');
    expect(errors[0]).toContain('天命不足 10');
    expect(errors[0]).toContain('本回合未使用符水粥');
    expect(tpOf('player1').huangtianDeclaredTurn).toBe(-1);
  });

  it('不能重复宣告', () => {
    readyToDeclare('player1');
    send('player1', 'taipingDeclareHuangtian');
    errors.length = 0;
    send('player1', 'taipingDeclareHuangtian');
    expect(errors).toEqual(['黄天当立已在宣告中']);
  });

  it('太平阵亡后永久失去，宣告被拒', () => {
    room.state.player1Taiping.destiny = 12;
    room.state.player1Taiping.fushuiUsedThisTurn = true;
    send('player1', 'taipingDeclareHuangtian');
    expect(errors).toEqual(['太平已阵亡，永久失去黄天当立']);
  });

  it('不是太平的一方不能宣告', () => {
    readyToDeclare('player1');
    room.state.currentPlayer = 'player2';
    send('player2', 'taipingDeclareHuangtian');
    expect(errors).toEqual(['你没有太平']);
  });

  it('不是自己的回合时拒绝', () => {
    readyToDeclare('player1');
    room.state.currentPlayer = 'player2';
    send('player1', 'taipingDeclareHuangtian');
    expect(errors).toEqual(['不是你的回合']);
  });
});

describe('宣告当回合的结算复查', () => {
  it('夺天命把天命打回 9 → 宣告当场失效', () => {
    readyToDeclare('player1');
    send('player1', 'taipingDeclareHuangtian');
    expect(tpOf('player1').huangtianDeclaredTurn).toBe(1);

    // 黄天 1 / 苍天 6 → 天命 10 → 9
    let i = 0;
    room.rng = () => [0, 5 / 6][i++ % 2]!;
    room.settleDestiny('player1');

    expect(room.state.player1Taiping.destiny).toBe(9);
    expect(tpOf('player1').huangtianDeclaredTurn).toBe(-1);
    expect(room.state.battleLog.some(l => l.includes('天命跌破 10'))).toBe(true);
  });

  it('骰子不动天命 → 宣告保留', () => {
    readyToDeclare('player1');
    send('player1', 'taipingDeclareHuangtian');
    room.settleDestiny('player1');
    expect(tpOf('player1').huangtianDeclaredTurn).toBe(1);
  });

  it('没超载也会走到复查（最容易漏的分支）', () => {
    // 黄天当立路线的常态就是「力士不超载」。如果复查写在超载分支里，
    // 这条路线永远不会被复查到。
    readyToDeclare('player1');
    lishi('l1', 'player1', 1, 0); // 1 个力士，承载 6，远不超
    send('player1', 'taipingDeclareHuangtian');

    let i = 0;
    room.rng = () => [0, 5 / 6][i++ % 2]!; // 天命 10 → 9
    room.settleDestiny('player1');

    expect(tpOf('player1').huangtianDeclaredTurn).toBe(-1);
  });

  it('天命难承压死太平 → 宣告作废', () => {
    const g = readyToDeclare('player1');
    g.hp = 1;
    for (let i = 0; i < 7; i++) lishi(`l${i}`, 'player1', i - 3, 1); // 超载
    // 先宣告（此刻还没超载判定，但条件 4 已经不满足，所以要手动放行）
    room.state.player1Taiping.huangtianDeclaredTurn = 1;

    room.settleDestiny('player1');

    expect(room.state.units.has(g.id)).toBe(false);
    expect(tpOf('player1').huangtianDeclaredTurn).toBe(-1);
    expect(room.state.battleLog.some(l => l.includes('随太平阵亡而作废'))).toBe(true);
  });
});

describe('时序：对手的一个完整回合', () => {
  it('player1 宣告：对手打一回合后，player1 回合开始取胜', () => {
    readyToDeclare('player1');
    send('player1', 'taipingDeclareHuangtian');

    room.handleEndTurn(client('player1'));   // → player2，turn 仍为 1
    expect(room.state.currentPlayer).toBe('player2');
    expect(room.state.turn).toBe(1);
    expect(room.state.phase).toBe('action'); // 对手回合里还没赢

    room.handleEndTurn(client('player2'));   // → player1，turn++ → 2，顺带触发判定
    expect(room.state.turn).toBe(2);
    expect(room.state.phase).toBe('end');
    expect(room.state.battleLog.some(l => l.includes('达成特殊胜利'))).toBe(true);
  });

  it('player2 宣告：时序同样是一个完整对手回合', () => {
    room = newGame('wushuang', 'taiping');
    room.state.currentPlayer = 'player2';
    readyToDeclare('player2', 0, 0);
    send('player2', 'taipingDeclareHuangtian');
    expect(tpOf('player2').huangtianDeclaredTurn).toBe(1);

    room.handleEndTurn(client('player2'));   // → player1，turn++ → 2
    expect(room.state.currentPlayer).toBe('player1');
    expect(room.state.turn).toBe(2);
    expect(room.state.phase).toBe('action');

    room.handleEndTurn(client('player1'));   // → player2，turn 仍为 2，触发判定
    expect(room.state.phase).toBe('end');
  });

  it('宣告的那个回合结束时不会立刻取胜', () => {
    readyToDeclare('player1');
    send('player1', 'taipingDeclareHuangtian');
    room.handleEndTurn(client('player1'));
    expect(room.state.phase).toBe('action');
  });
});

describe('对手的反制', () => {
  function declaredThenOpponentTurn(breakIt: () => void) {
    readyToDeclare('player1');
    send('player1', 'taipingDeclareHuangtian');
    room.handleEndTurn(client('player1'));   // → player2
    breakIt();
    room.handleEndTurn(client('player2'));   // → player1，触发判定
  }

  it('把太平赶出交战区 → 反制成功', () => {
    declaredThenOpponentTurn(() => {
      const g = room.state.units.get('g_player1')!;
      g.r = 3; g.s = -3; // 退回起始区
    });
    expect(room.state.phase).toBe('action');
    expect(tpOf('player1').huangtianDeclaredTurn).toBe(-1);
    expect(room.state.battleLog.some(l => l.includes('太平离开交战区'))).toBe(true);
  });

  it('杀平民把天命压到 9 → 反制成功', () => {
    declaredThenOpponentTurn(() => {
      const c = place('c1', 'neutral_marker', 'neutral', 2, 0, {
        hp: 1, maxHp: 1, statusTag: CIVILIAN_TAG,
      });
      room.killUnit(c);
    });
    expect(room.state.player1Taiping.destiny).toBe(9);
    expect(room.state.phase).toBe('action');
  });

  it('打死太平 → 反制成功且永久失去这条路线', () => {
    declaredThenOpponentTurn(() => {
      room.killUnit(room.state.units.get('g_player1')!);
    });
    expect(room.state.phase).toBe('action');
    expect(tpOf('player1').huangtianDeclaredTurn).toBe(-1);

    // 之后再也宣告不了
    errors.length = 0;
    room.state.currentPlayer = 'player1';
    send('player1', 'taipingDeclareHuangtian');
    expect(errors).toEqual(['太平已阵亡，永久失去黄天当立']);
  });

  it('反制失败（什么都不做）→ 太平取胜', () => {
    declaredThenOpponentTurn(() => { /* 对手束手无策 */ });
    expect(room.state.phase).toBe('end');
  });

  it('宣告失效后可以重新满足条件再次宣告', () => {
    declaredThenOpponentTurn(() => {
      const g = room.state.units.get('g_player1')!;
      g.r = 3; g.s = -3;
    });
    expect(tpOf('player1').huangtianDeclaredTurn).toBe(-1);

    // 走回交战区、再用一次符水粥
    const g = room.state.units.get('g_player1')!;
    g.r = 0; g.s = 0;
    room.state.player1Taiping.fushuiUsedThisTurn = true;
    room.state.currentPlayer = 'player1';
    errors.length = 0;
    send('player1', 'taipingDeclareHuangtian');
    expect(errors).toEqual([]);
    expect(tpOf('player1').huangtianDeclaredTurn).toBe(room.state.turn);
  });
});

describe('下发给客户端的条件清单', () => {
  it('太平方拿到逐条清单与宣告状态', () => {
    readyToDeclare('player1');
    const h = room.buildValidActions().huangtian!;
    expect(h).toMatchObject({
      destinyEnough: true, inBattleZone: true,
      fushuiUsed: true, withinCapacity: true, ok: true,
      declaredTurn: -1,
    });
  });

  it('宣告后 declaredTurn 跟着变', () => {
    readyToDeclare('player1');
    send('player1', 'taipingDeclareHuangtian');
    expect(room.buildValidActions().huangtian!.declaredTurn).toBe(1);
  });

  it('非太平方拿到 null', () => {
    room = newGame('wushuang', 'shenji');
    place('gw', 'general', 'player1', 0, 0, { generalType: 'wushuang', hp: 4, maxHp: 4 });
    expect(room.buildValidActions().huangtian).toBeNull();
  });
});
