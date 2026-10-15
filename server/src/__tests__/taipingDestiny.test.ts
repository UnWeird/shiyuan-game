import { beforeEach, describe, expect, it } from 'vitest';
import { ShiyuanRoom } from '../rooms/ShiyuanRoom';
import { GameStateSchema, UnitSchema } from '../schema/GameState';
import {
  CIVILIAN_TAG,
  DESTINY_INITIAL,
  DESTINY_MAX,
  DESTINY_MIN,
  countLishi,
  getDestinyCapacity,
  isOverCapacity,
  type UnitLike,
} from '../../../shared/rules/queries';

/**
 * 太平 · 天命（夺天命 + 天命难承）
 *
 * 两条规则在 §7.1 里是第 5、6 步，顺序不能换 ——
 * 天命难承比较的是夺天命**之后**的承载量。测试里有两条专门锁这个顺序。
 */

type RoomProbe = {
  state: GameStateSchema;
  setState: (s: GameStateSchema) => void;
  rng: () => number;
  unitList: UnitLike[];
  settleDestiny: (role: 'player1' | 'player2') => void;
  handleEndTurn: (c: unknown) => void;
  getPlayerRole: (c: unknown) => 'player1' | 'player2' | null;
};

let room: RoomProbe;

const client = (role: 'player1' | 'player2') => ({ sessionId: role, send: () => {} });

function newGame(p1 = 'taiping', p2 = 'wushuang'): RoomProbe {
  const r = new ShiyuanRoom() as unknown as RoomProbe;
  r.setState(new GameStateSchema());
  r.state.phase = 'action';
  r.state.currentPlayer = 'player1';
  r.state.player1General = p1;
  r.state.player2General = p2;
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

const taiping = (role: 'player1' | 'player2', q = 0, r = 4) =>
  place(`g_${role}`, 'general', role, q, r, { generalType: 'taiping', hp: 3, maxHp: 3 });

/** 放 n 个黄巾力士 */
function lishi(role: 'player1' | 'player2', n: number, hp = 2) {
  for (let i = 0; i < n; i++) {
    place(`l_${role}_${i}`, 'huangjin_lishi', role, i - 3, role === 'player1' ? 2 : -2, { hp, maxHp: 2 });
  }
}

/** 让 rollD6 依次产出给定点数。settleDestiny 先投黄天、后投苍天 */
function dice(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length]!;
    i++;
    return (v - 1) / 6;
  };
}

beforeEach(() => {
  room = newGame();
});

describe('承载量（纯函数）', () => {
  it('= 1 + ⌈天命 / 2⌉，七档全覆盖', () => {
    const table: Array<[number, number]> = [
      [0, 1],
      [1, 2], [2, 2],
      [3, 3], [4, 3],
      [5, 4], [6, 4],
      [7, 5], [8, 5],
      [9, 6], [10, 6],
      [11, 7], [12, 7],
    ];
    for (const [destiny, capacity] of table) {
      expect(getDestinyCapacity(destiny)).toBe(capacity);
    }
  });

  it('isOverCapacity 只在严格大于时成立', () => {
    expect(isOverCapacity(5, 4)).toBe(false); // 承载 4，刚好 4 个
    expect(isOverCapacity(5, 5)).toBe(true);
    expect(isOverCapacity(0, 1)).toBe(false); // 天命 0 也能带 1 个
    expect(isOverCapacity(0, 2)).toBe(true);
  });

  it('开局天命是 5，上下限是 0 / 12', () => {
    expect(DESTINY_INITIAL).toBe(5);
    expect(DESTINY_MIN).toBe(0);
    expect(DESTINY_MAX).toBe(12);
    expect(new GameStateSchema().player1Taiping.destiny).toBe(DESTINY_INITIAL);
  });
});

describe('countLishi（纯函数）', () => {
  it('只数己方的力士', () => {
    lishi('player1', 3);
    lishi('player2', 2);
    expect(countLishi(room.unitList, 'player1')).toBe(3);
    expect(countLishi(room.unitList, 'player2')).toBe(2);
  });

  it('残血力士照样占一格承载', () => {
    lishi('player1', 2, 1);
    expect(countLishi(room.unitList, 'player1')).toBe(2);
  });

  it('转成平民之后就不再占承载（不需要额外逻辑）', () => {
    lishi('player1', 2);
    const one = room.state.units.get('l_player1_0')!;
    one.type = 'neutral_marker';
    one.owner = 'neutral';
    one.statusTag = CIVILIAN_TAG;
    one.hp = 1;
    expect(countLishi(room.unitList, 'player1')).toBe(1);
  });
});

describe('夺天命', () => {
  it('黄天 > 苍天 → 天命 +1', () => {
    taiping('player1');
    room.state.player1Taiping.destiny = 5;
    room.rng = dice([6, 2]);
    room.settleDestiny('player1');
    expect(room.state.player1Taiping.destiny).toBe(6);
  });

  it('黄天 < 苍天 → 天命 −1', () => {
    taiping('player1');
    room.state.player1Taiping.destiny = 5;
    room.rng = dice([2, 6]);
    room.settleDestiny('player1');
    expect(room.state.player1Taiping.destiny).toBe(4);
  });

  it('两骰相等 → 天命不变', () => {
    taiping('player1');
    room.state.player1Taiping.destiny = 5;
    room.rng = dice([4, 4]);
    room.settleDestiny('player1');
    expect(room.state.player1Taiping.destiny).toBe(5);
  });

  it('骰子结果写进 state 供界面展示', () => {
    taiping('player1');
    room.rng = dice([3, 5]);
    room.settleDestiny('player1');
    expect(room.state.player1Taiping.lastHuangtian).toBe(3);
    expect(room.state.player1Taiping.lastCangtian).toBe(5);
  });

  it('天命 12 时再 +1 仍是 12', () => {
    taiping('player1');
    room.state.player1Taiping.destiny = 12;
    room.rng = dice([6, 1]);
    room.settleDestiny('player1');
    expect(room.state.player1Taiping.destiny).toBe(12);
  });

  it('天命 0 时再 −1 仍是 0', () => {
    taiping('player1');
    room.state.player1Taiping.destiny = 0;
    room.rng = dice([1, 6]);
    room.settleDestiny('player1');
    expect(room.state.player1Taiping.destiny).toBe(0);
  });

  it('没选太平的一方不结算', () => {
    taiping('player1');
    room.rng = dice([6, 1]);
    room.settleDestiny('player2');
    expect(room.state.player2Taiping.destiny).toBe(5);
    expect(room.state.player2Taiping.lastHuangtian).toBe(0);
  });

  it('太平已阵亡则整段跳过（§7.2 不再结算天命）', () => {
    // player1General 仍是 taiping，但场上没有太平将军单位
    room.state.player1Taiping.destiny = 5;
    room.rng = dice([6, 1]);
    room.settleDestiny('player1');
    expect(room.state.player1Taiping.destiny).toBe(5);
    expect(room.state.player1Taiping.lastHuangtian).toBe(0);
  });

  it('双太平各自独立结算，不共享天命', () => {
    room = newGame('taiping', 'taiping');
    taiping('player1', 0, 4);
    taiping('player2', 0, -4);
    room.state.player1Taiping.destiny = 5;
    room.state.player2Taiping.destiny = 5;

    room.rng = dice([6, 1]);
    room.settleDestiny('player1');
    expect(room.state.player1Taiping.destiny).toBe(6);
    expect(room.state.player2Taiping.destiny).toBe(5);

    room.rng = dice([1, 6]);
    room.settleDestiny('player2');
    expect(room.state.player1Taiping.destiny).toBe(6);
    expect(room.state.player2Taiping.destiny).toBe(4);
  });
});

describe('天命难承', () => {
  it('力士超出承载 → 太平掉 1 点体力', () => {
    const g = taiping('player1');
    room.state.player1Taiping.destiny = 5; // 承载 4
    lishi('player1', 5);
    room.rng = dice([4, 4]);               // 天命不变
    room.settleDestiny('player1');
    expect(g.hp).toBe(2);
  });

  it('无论超出多少，每回合最多掉 1 点', () => {
    const g = taiping('player1');
    room.state.player1Taiping.destiny = 0; // 承载 1
    lishi('player1', 7);                   // 超出 6 个
    room.rng = dice([4, 4]);
    room.settleDestiny('player1');
    expect(g.hp).toBe(2);
  });

  it('刚好等于承载时不掉血', () => {
    const g = taiping('player1');
    room.state.player1Taiping.destiny = 5; // 承载 4
    lishi('player1', 4);
    room.rng = dice([4, 4]);
    room.settleDestiny('player1');
    expect(g.hp).toBe(3);
  });

  it('只看己方力士，对手的力士不压自己的承载', () => {
    const g = taiping('player1');
    room.state.player1Taiping.destiny = 0; // 承载 1
    lishi('player1', 1);
    lishi('player2', 6);
    room.rng = dice([4, 4]);
    room.settleDestiny('player1');
    expect(g.hp).toBe(3);
  });

  it('比较的是夺天命之后的天命：骰子救了太平一命', () => {
    const g = taiping('player1');
    room.state.player1Taiping.destiny = 4; // 承载 3
    lishi('player1', 4);                   // 此刻 4 > 3，本该掉血
    room.rng = dice([6, 1]);               // 黄天 > 苍天 → 天命 5 → 承载 4
    room.settleDestiny('player1');
    expect(room.state.player1Taiping.destiny).toBe(5);
    expect(g.hp).toBe(3);                  // 顺序对调的话这里会是 2
  });

  it('比较的是夺天命之后的天命：骰子害死了太平', () => {
    const g = taiping('player1');
    room.state.player1Taiping.destiny = 5; // 承载 4
    lishi('player1', 4);                   // 此刻刚好不超
    room.rng = dice([1, 6]);               // 黄天 < 苍天 → 天命 4 → 承载 3
    room.settleDestiny('player1');
    expect(room.state.player1Taiping.destiny).toBe(4);
    expect(g.hp).toBe(2);                  // 顺序对调的话这里会是 3
  });

  it('残血力士照样算一格，不会因为残血就免压', () => {
    const g = taiping('player1');
    room.state.player1Taiping.destiny = 0; // 承载 1
    lishi('player1', 2, 1);                // 两个 1 血力士
    room.rng = dice([4, 4]);
    room.settleDestiny('player1');
    expect(g.hp).toBe(2);
  });

  it('体力归零 → 太平阵亡，从场上移除', () => {
    const g = taiping('player1');
    g.hp = 1;
    room.state.player1Taiping.destiny = 0;
    lishi('player1', 3);
    room.rng = dice([4, 4]);
    room.settleDestiny('player1');
    expect(room.state.units.has(g.id)).toBe(false);
    expect(room.state.battleLog.some(l => l.includes('苍天已死'))).toBe(true);
  });

  it('连续三个回合超载就会压死满血太平', () => {
    const g = taiping('player1');
    room.state.player1Taiping.destiny = 0;
    lishi('player1', 3);
    room.rng = dice([4, 4]); // 天命恒定不变
    room.settleDestiny('player1');
    expect(g.hp).toBe(2);
    room.settleDestiny('player1');
    expect(g.hp).toBe(1);
    room.settleDestiny('player1');
    expect(room.state.units.has(g.id)).toBe(false);
  });
});

describe('接进回合结束', () => {
  it('handleEndTurn 会触发太平的天命结算', () => {
    taiping('player1');
    room.state.player1Taiping.destiny = 5;
    room.rng = dice([6, 1]);
    room.handleEndTurn(client('player1'));
    expect(room.state.player1Taiping.destiny).toBe(6);
    expect(room.state.currentPlayer).toBe('player2');
  });

  it('只结算结束回合那一方的天命', () => {
    room = newGame('taiping', 'taiping');
    taiping('player1', 0, 4);
    taiping('player2', 0, -4);
    room.state.player1Taiping.destiny = 5;
    room.state.player2Taiping.destiny = 5;
    room.rng = dice([6, 1]); // 恒定「黄天 6 / 苍天 1」，谁结算谁 +1
    room.handleEndTurn(client('player1'));
    expect(room.state.player1Taiping.destiny).toBe(6);
    expect(room.state.player2Taiping.destiny).toBe(5);
  });

  it('部署阶段结束回合不结算天命', () => {
    taiping('player1');
    room.state.phase = 'deploy';
    room.state.player1Taiping.destiny = 5;
    room.rng = dice([6, 1]);
    room.handleEndTurn(client('player1'));
    expect(room.state.player1Taiping.destiny).toBe(5);
  });
});
