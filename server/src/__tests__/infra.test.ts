import { describe, expect, it } from 'vitest';
import { ShiyuanRoom } from '../rooms/ShiyuanRoom';
import { GameStateSchema, UnitSchema, TaipingSchema } from '../schema/GameState';
import { restoreState, captureState } from '../dev/stateSnapshot';

/**
 * 基础设施的测试：随机源接缝、单位 id 计数器、Schema 结构。
 *
 * 这三样本身没有任何游戏规则，但它们决定了规则**能不能被测**：
 * 掷骰分支（无双「≤2 才能再攻击」、太平夺天命）原来靠运气才跑得到，
 * 单位 id 每次都不一样，测试没法指代具体单位。
 */

type RoomProbe = {
  state: GameStateSchema;
  setState: (s: GameStateSchema) => void;
  rng: () => number;
  rollD6: () => number;
  nextUnitId: number;
  newUnitId: (kind: string) => string;
  syncUnitIdCounter: () => void;
};

function newRoom(): RoomProbe {
  const room = new ShiyuanRoom() as unknown as RoomProbe;
  room.setState(new GameStateSchema());
  return room;
}

/** 把一串定值喂给 rng：返回的 rng 会让 rollD6 依次产出 values */
function fixedD6(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length]!;
    i++;
    // rollD6 做的是 floor(rng() * 6) + 1，所以 rng 要回 (v-1)/6
    return (v - 1) / 6;
  };
}

describe('随机源接缝', () => {
  it('rollD6 默认落在 1..6', () => {
    const room = newRoom();
    for (let i = 0; i < 200; i++) {
      const v = room.rollD6();
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('替换 rng 后 rollD6 完全可预测', () => {
    const room = newRoom();
    room.rng = fixedD6([1, 6, 3, 4]);
    expect([room.rollD6(), room.rollD6(), room.rollD6(), room.rollD6()]).toEqual([1, 6, 3, 4]);
  });

  it('rng 返回边界值时 rollD6 不越界', () => {
    const room = newRoom();
    // Math.random() 的值域是 [0, 1)，两端都要落在 1..6 内
    room.rng = () => 0;
    expect(room.rollD6()).toBe(1);
    room.rng = () => 0.999999;
    expect(room.rollD6()).toBe(6);
  });

  it('房间里不再有裸的 Math.random（接缝之外）', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../rooms/ShiyuanRoom.ts', import.meta.url), 'utf-8');
    // 允许的唯一一处是接缝自己的默认值
    const hits = src
      .split('\n')
      .filter(l => l.includes('Math.random') && !l.includes('private rng') && !l.trimStart().startsWith('*'));
    expect(hits).toEqual([]);
  });
});

describe('单位 id', () => {
  it('带类型前缀、单调递增、互不重复', () => {
    const room = newRoom();
    const ids = [
      room.newUnitId('infantry'),
      room.newUnitId('infantry'),
      room.newUnitId('ballista'),
      room.newUnitId('civ'),
    ];
    expect(ids).toEqual(['infantry1', 'infantry2', 'ballista3', 'civ4']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('已删除的单位不会让 id 被复用', () => {
    const room = newRoom();
    const first = room.newUnitId('infantry');
    const u = new UnitSchema();
    u.id = first;
    room.state.units.set(first, u);
    room.state.units.delete(first);
    expect(room.newUnitId('infantry')).not.toBe(first);
  });

  it('载入快照后计数器跳到快照里所有 id 之后', () => {
    const room = newRoom();
    for (const id of ['infantry7', 'civ12', 'lishi3']) {
      const u = new UnitSchema();
      u.id = id;
      u.q = 0; u.r = 0; u.s = 0;
      room.state.units.set(id, u);
    }
    room.nextUnitId = 1; // 模拟新房间载入旧快照
    room.syncUnitIdCounter();
    expect(room.newUnitId('civ')).toBe('civ13');
  });

  it('计数器只会前进，不会被快照拉回去', () => {
    const room = newRoom();
    room.nextUnitId = 50;
    const u = new UnitSchema();
    u.id = 'infantry2';
    room.state.units.set('infantry2', u);
    room.syncUnitIdCounter();
    expect(room.nextUnitId).toBe(50);
  });
});

describe('Schema 结构', () => {
  /** 数一个 Schema 类声明了几个 @type 字段 */
  function fieldCount(cls: unknown): number {
    const md = (cls as Record<symbol, unknown>)[Symbol.metadata as unknown as symbol] as Record<string, unknown>;
    return Object.keys(md).filter(k => /^\d+$/.test(k)).length;
  }

  it('GameStateSchema 仍在 Colyseus 的 64 字段上限内', () => {
    // 旧太平那 14 个字段正好把它占满过（commit dc72383），所以这条要一直盯着
    expect(fieldCount(GameStateSchema)).toBeLessThanOrEqual(64);
  });

  it('太平状态是嵌套的，顶层只占 2 格', () => {
    const md = (GameStateSchema as any)[Symbol.metadata];
    const names = Object.keys(md)
      .filter(k => /^\d+$/.test(k))
      .map(k => md[k].name as string);
    expect(names.filter(n => n.toLowerCase().includes('taiping'))).toEqual([
      'player1Taiping',
      'player2Taiping',
    ]);
  });

  it('实例化后太平初始天命为 5、未宣告黄天当立', () => {
    const s = new GameStateSchema();
    expect(s.player1Taiping.destiny).toBe(5);
    expect(s.player2Taiping.destiny).toBe(5);
    expect(s.player1Taiping.huangtianDeclaredTurn).toBe(-1);
    expect(s.player1Taiping.pendingRecruit.length).toBe(0);
  });

  it('两方的太平状态是各自独立的实例', () => {
    const s = new GameStateSchema();
    s.player1Taiping.destiny = 11;
    expect(s.player2Taiping.destiny).toBe(5);
  });

  it('单位默认未充能、无 statusTag', () => {
    const u = new UnitSchema();
    expect(u.charged).toBe(false);
    expect(u.statusTag).toBe('');
  });
});

describe('开发快照与嵌套 Schema', () => {
  it('存读一轮后嵌套的太平状态被保留', () => {
    const a = new GameStateSchema();
    a.player1Taiping.destiny = 11;
    a.player1Taiping.huangtianDeclaredTurn = 7;
    a.player1Taiping.pendingRecruit.push('civ3');
    a.player1Taiping.pendingRecruit.push('civ4');
    a.player2Taiping.destiny = 0;

    const b = new GameStateSchema();
    const result = restoreState(b, captureState(a, 'probe'));

    expect(result.ok).toBe(true);
    expect(result.unknownFields).toEqual([]);
    expect(b.player1Taiping.destiny).toBe(11);
    expect(b.player1Taiping.huangtianDeclaredTurn).toBe(7);
    expect(Array.from(b.player1Taiping.pendingRecruit)).toEqual(['civ3', 'civ4']);
    expect(b.player2Taiping.destiny).toBe(0);
  });

  it('载入后嵌套字段仍是 Schema 实例（否则整棵子树不再同步）', () => {
    const a = new GameStateSchema();
    a.player1Taiping.destiny = 9;
    const b = new GameStateSchema();
    restoreState(b, captureState(a));
    expect(b.player1Taiping).toBeInstanceOf(TaipingSchema);
    expect(typeof b.player1Taiping.pendingRecruit.push).toBe('function');
  });

  it('载入会清掉上一局残留的待办队列', () => {
    const a = new GameStateSchema();
    const b = new GameStateSchema();
    b.player1Taiping.pendingRecruit.push('civ99');
    restoreState(b, captureState(a));
    expect(b.player1Taiping.pendingRecruit.length).toBe(0);
  });
});
