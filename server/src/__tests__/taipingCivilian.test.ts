import { beforeEach, describe, expect, it } from 'vitest';
import { ShiyuanRoom } from '../rooms/ShiyuanRoom';
import { GameStateSchema, UnitSchema } from '../schema/GameState';
import {
  CIVILIAN_CAP,
  CIVILIAN_TAG,
  countCivilians,
  getCivilianSpawnCells,
  getCivilianSpawnCount,
  getCivilianSpawnRange,
  isCivilian,
  type UnitLike,
} from '../../../shared/rules/queries';
import { isInBattleZone, isInStartZone } from '../../../shared/utils/hexUtils';

/**
 * 太平 · 公共平民的刷新
 *
 * 这一步的测试有一组**客观锚点**：交战区 49 格、低天命范围 70 格。
 * 它们不是抄当前输出得来的，而是从「边长 6 的六边形共 11 排、
 * 交战区占中间 5 排（9+10+11+10+9）、单侧起始区占 3 排（8+7+6）」算出来的，
 * 所以可以直接断言。
 */

type RoomProbe = {
  state: GameStateSchema;
  setState: (s: GameStateSchema) => void;
  rng: () => number;
  refreshCivilians: (role: 'player1' | 'player2') => void;
  unitList: UnitLike[];
};

let room: RoomProbe;

/** 开一局已进入行动阶段、player1 是太平的对局 */
function newGame(opts: { p1?: string; p2?: string } = {}): RoomProbe {
  const r = new ShiyuanRoom() as unknown as RoomProbe;
  r.setState(new GameStateSchema());
  r.state.phase = 'action';
  r.state.player1General = opts.p1 ?? 'taiping';
  r.state.player2General = opts.p2 ?? 'wushuang';
  // 大本营：双方起始区的最后一排中间
  r.state.player1BaseQ = 0; r.state.player1BaseR = 5; r.state.player1BaseS = -5;
  r.state.player2BaseQ = 0; r.state.player2BaseR = -5; r.state.player2BaseS = 5;
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

/** 放一个太平将军，使 isTaipingAlive 为真 */
function placeTaiping(role: 'player1' | 'player2', q = 0, r = 4) {
  return place(`g_${role}`, 'general', role, q, r, { generalType: 'taiping', hp: 3, maxHp: 3 });
}

/** 让 rng 依次返回定值（用于挑选池中的下标） */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

function civilians(): UnitSchema[] {
  return Array.from(room.state.units.values()).filter(u => u.statusTag === CIVILIAN_TAG);
}

beforeEach(() => {
  room = newGame();
});

describe('刷新范围（纯函数）', () => {
  it('天命 5–12：仅交战区，49 格', () => {
    for (const d of [5, 8, 9, 12]) {
      expect(getCivilianSpawnRange(d, 'player1')).toHaveLength(49);
    }
  });

  it('天命 0–4：交战区 + 己方起始区，70 格', () => {
    for (const d of [0, 1, 3, 4]) {
      expect(getCivilianSpawnRange(d, 'player1')).toHaveLength(70);
    }
  });

  it('天命 4 与 5 的差集恰好是该玩家起始区的 21 格', () => {
    const key = (h: { q: number; r: number }) => `${h.q},${h.r}`;
    const low = getCivilianSpawnRange(4, 'player1').map(key);
    const high = new Set(getCivilianSpawnRange(5, 'player1').map(key));
    const extra = low.filter(k => !high.has(k));
    expect(extra).toHaveLength(21);
    // 多出来的全在 player1 的起始区
    for (const k of extra) {
      const [q, r] = k.split(',').map(Number) as [number, number];
      expect(isInStartZone({ q, r, s: -q - r }, 'top')).toBe(true);
    }
  });

  it('低天命下两个太平玩家的范围不同（各含自己的起始区）', () => {
    const key = (h: { q: number; r: number }) => `${h.q},${h.r}`;
    const p1 = new Set(getCivilianSpawnRange(0, 'player1').map(key));
    const p2 = new Set(getCivilianSpawnRange(0, 'player2').map(key));
    expect(p1.size).toBe(70);
    expect(p2.size).toBe(70);
    // 交集就是交战区的 49 格
    expect([...p1].filter(k => p2.has(k))).toHaveLength(49);
  });

  it('范围内每一格都在交战区或己方起始区，没有越界格', () => {
    for (const hex of getCivilianSpawnRange(0, 'player1')) {
      expect(isInBattleZone(hex) || isInStartZone(hex, 'top')).toBe(true);
      expect(hex.q + hex.r + hex.s).toBe(0);
    }
    // 高天命时一格起始区都不能有
    for (const hex of getCivilianSpawnRange(9, 'player1')) {
      expect(isInBattleZone(hex)).toBe(true);
    }
  });
});

describe('刷新数量（纯函数）', () => {
  it('三档的边界', () => {
    expect([0, 1, 2, 3].map(getCivilianSpawnCount)).toEqual([1, 1, 1, 1]);
    expect([4, 5, 6, 7, 8].map(getCivilianSpawnCount)).toEqual([2, 2, 2, 2, 2]);
    expect([9, 10, 11, 12].map(getCivilianSpawnCount)).toEqual([3, 3, 3, 3]);
  });

  it('数量档位和范围档位是两张不同的表', () => {
    // 天命 4：数量已进第二档(2)，范围还在低档(70)
    expect(getCivilianSpawnCount(4)).toBe(2);
    expect(getCivilianSpawnRange(4, 'player1')).toHaveLength(70);
    // 天命 5：数量仍是 2，范围已收窄
    expect(getCivilianSpawnCount(5)).toBe(2);
    expect(getCivilianSpawnRange(5, 'player1')).toHaveLength(49);
  });
});

describe('可落子格的排除规则（纯函数）', () => {
  it('排除单位占据的格', () => {
    placeTaiping('player1', 0, 2);
    const cells = getCivilianSpawnCells(9, 'player1', room.unitList, []);
    expect(cells).toHaveLength(48);
    expect(cells.some(c => c.q === 0 && c.r === 2)).toBe(false);
  });

  it('排除机关的整个车身，不只是中心格', () => {
    place('bal', 'ballista', 'player2', 0, 0);
    const cells = getCivilianSpawnCells(9, 'player1', room.unitList, []);
    // 弩车占 3 格，三格都应被排除
    expect(cells).toHaveLength(46);
  });

  it('排除双方大本营格', () => {
    // 大本营在起始区，所以要用低天命范围才会包含它
    const withBases = getCivilianSpawnCells(0, 'player1', [], [
      { q: 0, r: 5, s: -5 },
      { q: 0, r: -5, s: 5 },
    ]);
    const withoutBases = getCivilianSpawnCells(0, 'player1', [], []);
    // player1 的大本营在自己起始区内（在范围里），player2 的不在范围里
    expect(withoutBases.length - withBases.length).toBe(1);
    expect(withBases.some(c => c.q === 0 && c.r === 5)).toBe(false);
  });
});

describe('刷新结算（房间）', () => {
  it('天命 5 的太平回合刷 2 名平民', () => {
    placeTaiping('player1');
    room.state.player1Taiping.destiny = 5;
    room.refreshCivilians('player1');
    expect(civilians()).toHaveLength(2);
  });

  it('平民是 1 血中立单位，带 civilian 标记', () => {
    placeTaiping('player1');
    room.refreshCivilians('player1');
    const c = civilians()[0]!;
    expect(c.type).toBe('neutral_marker');
    expect(c.owner).toBe('neutral');
    expect(c.hp).toBe(1);
    expect(c.maxHp).toBe(1);
    expect(isCivilian(c as unknown as UnitLike)).toBe(true);
  });

  it('刷新位置一定落在当前天命对应的范围内', () => {
    placeTaiping('player1');
    room.state.player1Taiping.destiny = 9; // 仅交战区
    room.refreshCivilians('player1');
    for (const c of civilians()) {
      expect(isInBattleZone({ q: c.q, r: c.r, s: c.s })).toBe(true);
    }
  });

  it('天命 0 时平民真的会出现在太平自己的起始区', () => {
    placeTaiping('player1', 0, 3);
    room.state.player1Taiping.destiny = 0;
    // 把交战区全部占满，只给起始区留空位。
    // 若范围没有包含起始区，这一轮就该刷不出任何平民。
    let n = 0;
    for (const hex of getCivilianSpawnRange(12, 'player1')) {
      place(`blk${n++}`, 'infantry', 'player2', hex.q, hex.r);
    }
    room.refreshCivilians('player1');
    const cs = civilians();
    expect(cs).toHaveLength(1);
    expect(isInStartZone({ q: cs[0]!.q, r: cs[0]!.r, s: cs[0]!.s }, 'top')).toBe(true);
  });

  it('大本营格不会被平民占住（范围里只剩大本营时一个也刷不出）', () => {
    // 这条是房间级的：纯函数那边已经测了排除逻辑，但房间有没有把
    // baseHexes 传进去是另一回事（漏传时纯函数测试照样绿）。
    placeTaiping('player1', 0, 3);
    room.state.player1Taiping.destiny = 0; // 范围含 player1 起始区，里面有自家大本营
    const base = { q: room.state.player1BaseQ, r: room.state.player1BaseR };
    let n = 0;
    for (const hex of getCivilianSpawnRange(0, 'player1')) {
      if (hex.q === base.q && hex.r === base.r) continue; // 唯一留空的格就是大本营
      if (hex.q === 0 && hex.r === 3) continue;           // 太平自己站的格
      place(`blk${n++}`, 'infantry', 'player2', hex.q, hex.r);
    }
    room.refreshCivilians('player1');
    expect(civilians()).toHaveLength(0);
  });

  it('天命 5 时交战区占满就刷不出来（起始区不在范围内）', () => {
    placeTaiping('player1', 0, 3);
    room.state.player1Taiping.destiny = 5;
    let n = 0;
    for (const hex of getCivilianSpawnRange(12, 'player1')) {
      place(`blk${n++}`, 'infantry', 'player2', hex.q, hex.r);
    }
    room.refreshCivilians('player1');
    expect(civilians()).toHaveLength(0);
  });

  it('不会刷在已被占据的格子上', () => {
    placeTaiping('player1');
    room.state.player1Taiping.destiny = 12; // 刷 3 个
    // 用交战区的所有格子铺满，只留一格
    const free = { q: 0, r: 0, s: 0 };
    let n = 0;
    for (const hex of getCivilianSpawnRange(12, 'player1')) {
      if (hex.q === free.q && hex.r === free.r) continue;
      if (hex.q === 0 && hex.r === 4) continue; // 太平自己站的格不在交战区，跳过即可
      place(`blk${n++}`, 'infantry', 'player2', hex.q, hex.r);
    }
    room.refreshCivilians('player1');
    const cs = civilians();
    expect(cs).toHaveLength(1);
    expect({ q: cs[0]!.q, r: cs[0]!.r }).toEqual({ q: 0, r: 0 });
  });

  it('范围内无空格时什么都不刷，且不报错', () => {
    placeTaiping('player1');
    let n = 0;
    for (const hex of getCivilianSpawnRange(12, 'player1')) {
      place(`blk${n++}`, 'infantry', 'player2', hex.q, hex.r);
    }
    room.state.player1Taiping.destiny = 12;
    expect(() => room.refreshCivilians('player1')).not.toThrow();
    expect(civilians()).toHaveLength(0);
  });

  it('场上已有 5 名平民时不再刷新', () => {
    placeTaiping('player1');
    for (let i = 0; i < CIVILIAN_CAP; i++) {
      place(`c${i}`, 'neutral_marker', 'neutral', i - 2, 0, { hp: 1, maxHp: 1, statusTag: CIVILIAN_TAG });
    }
    room.state.player1Taiping.destiny = 12;
    room.refreshCivilians('player1');
    expect(civilians()).toHaveLength(5);
  });

  it('场上 4 名时只补到 5，不按天命刷满 3 个', () => {
    placeTaiping('player1');
    for (let i = 0; i < 4; i++) {
      place(`c${i}`, 'neutral_marker', 'neutral', i - 2, 0, { hp: 1, maxHp: 1, statusTag: CIVILIAN_TAG });
    }
    room.state.player1Taiping.destiny = 12; // 本应刷 3
    room.refreshCivilians('player1');
    expect(civilians()).toHaveLength(5);
  });

  it('仁德自造的中立标记不计入平民总数', () => {
    placeTaiping('player1');
    for (let i = 0; i < CIVILIAN_CAP; i++) {
      // statusTag 为空 —— 这是仁德「以德服人」留下的中立标记
      place(`n${i}`, 'neutral_marker', 'neutral', i - 2, 1, { hp: 1, maxHp: 1 });
    }
    room.state.player1Taiping.destiny = 0;
    room.refreshCivilians('player1');
    expect(civilians()).toHaveLength(1);
    expect(countCivilians(room.unitList)).toBe(1);
  });

  it('部署阶段不刷新', () => {
    placeTaiping('player1');
    room.state.phase = 'deploy';
    room.refreshCivilians('player1');
    expect(civilians()).toHaveLength(0);
  });

  it('没选太平的一方回合不刷新', () => {
    placeTaiping('player1');
    room.refreshCivilians('player2'); // player2 是无双
    expect(civilians()).toHaveLength(0);
  });

  it('太平死后固定刷 1 名，不看天命', () => {
    // 不放太平将军单位 = 已阵亡，但 player1General 仍是 taiping
    room.state.player1Taiping.destiny = 12; // 存活时本该刷 3
    room.refreshCivilians('player1');
    expect(civilians()).toHaveLength(1);
  });

  it('太平死后刷新范围仍按冻结的天命值算', () => {
    room.state.player1Taiping.destiny = 0; // 低天命 → 含己方起始区
    room.rng = seq([0]);
    room.refreshCivilians('player1');
    const c = civilians()[0]!;
    const hex = { q: c.q, r: c.r, s: c.s };
    expect(isInBattleZone(hex) || isInStartZone(hex, 'top')).toBe(true);
  });

  it('双太平：两方各自回合都刷新，共享 5 名上限', () => {
    room = newGame({ p1: 'taiping', p2: 'taiping' });
    placeTaiping('player1', 0, 4);
    placeTaiping('player2', 0, -4);
    room.state.player1Taiping.destiny = 12; // 各刷 3
    room.state.player2Taiping.destiny = 12;
    room.refreshCivilians('player1');
    expect(civilians()).toHaveLength(3);
    room.refreshCivilians('player2');
    // 共享上限 5，所以第二次只补 2 个
    expect(civilians()).toHaveLength(5);
  });

  it('刷出的平民 id 互不重复', () => {
    placeTaiping('player1');
    room.state.player1Taiping.destiny = 12;
    room.refreshCivilians('player1');
    const ids = civilians().map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('civ')).toBe(true);
  });
});
