import { beforeEach, describe, expect, it } from 'vitest';
import { ShiyuanRoom } from '../rooms/ShiyuanRoom';
import { GameStateSchema, UnitSchema } from '../schema/GameState';
import {
  CIVILIAN_TAG,
  DOUFAN_COST,
  DOUFAN_RANGE,
  countLishi,
  getCivilianSpawnRange,
  getDoufanSources,
  getDoufanTargets,
  type UnitLike,
} from '../../../shared/rules/queries';

/**
 * 太平 · 豆饭（强制征募）
 *
 * 规则本身不难，难的是**强制**二字：
 *   - 名单在阶段开始时快照（新转化的力士不能扩大本次范围）
 *   - 队列非空期间玩家的其他指令一律被拦住（不能主动拒绝）
 *   - AP 不足时自动放行（不透支、不欠账、不把玩家锁死）
 */

type RoomProbe = {
  state: GameStateSchema;
  setState: (s: GameStateSchema) => void;
  rng: () => number;
  unitList: UnitLike[];
  startDoufanPhase: (role: 'player1' | 'player2') => void;
  handleTaipingRecruit: (c: unknown, d: { civilianId: string }) => void;
  rejectIfForcedPhasePending: (c: unknown) => boolean;
  handleMoveUnit: (c: unknown, d: { unitId: string; toQ: number; toR: number; toS: number }) => void;
  handleEndTurn: (c: unknown) => void;
  handleTaipingFushui: (c: unknown, d: { civilianId: string }) => void;
  rollDiceForPlayer: (role: 'player1' | 'player2') => void;
  settleDestiny: (role: 'player1' | 'player2') => void;
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
  // 注册真实的消息处理器，这样测试能走 onAction 那层拦截，
  // 而不是绕过它直接调 handleXxx —— 拦截正是这一步要验的东西
  r.registerMessageHandlers();
  return r;
}

/** 按消息名走真实注册的处理器（含 onAction 的强制阶段拦截） */
function send(role: 'player1' | 'player2', type: string, data: unknown = {}) {
  room.onMessageHandlers[type]!.callback(client(role), data);
}

/** 本房间注册的玩家指令（排除 Colyseus 自己的内部键） */
function registeredTypes(): string[] {
  return Object.keys(room.onMessageHandlers).filter(k => !k.startsWith('__'));
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

const taiping = (role: 'player1' | 'player2' = 'player1', q = 0, r = 4) =>
  place(`g_${role}`, 'general', role, q, r, { generalType: 'taiping', hp: 3, maxHp: 3 });

const queue = () => Array.from(room.state.player1Taiping.pendingRecruit);
const lishiUnits = () =>
  Array.from(room.state.units.values()).filter(u => u.type === 'huangjin_lishi');

beforeEach(() => {
  errors.length = 0;
  room = newGame();
});

describe('征募源（纯函数）', () => {
  it('普通步兵与黄巾力士算，太平本人、骑兵、弓箭手、机关都不算', () => {
    taiping('player1', 0, 0);
    place('inf', 'infantry', 'player1', 1, 0);
    place('lsh', 'huangjin_lishi', 'player1', 2, 0);
    place('cav', 'cavalry', 'player1', 3, 0);
    place('arc', 'archer', 'player1', 4, 0);
    place('bal', 'ballista', 'player1', 0, 3);
    place('cha', 'chariot', 'player1', 0, 2);
    place('cat', 'catapult', 'player1', -3, 0);

    expect(getDoufanSources(room.unitList, 'player1').map(u => u.id).sort())
      .toEqual(['inf', 'lsh']);
  });

  it('只算己方的', () => {
    place('mine', 'infantry', 'player1', 0, 0);
    place('theirs', 'infantry', 'player2', 1, 0);
    expect(getDoufanSources(room.unitList, 'player1').map(u => u.id)).toEqual(['mine']);
  });

  it('残血力士照样是征募源', () => {
    place('lsh', 'huangjin_lishi', 'player1', 0, 0, { hp: 1 });
    expect(getDoufanSources(room.unitList, 'player1').map(u => u.id)).toEqual(['lsh']);
  });

  it('骑兵掉马退化成的步兵算（type 就是 infantry）', () => {
    const cav = place('c1', 'cavalry', 'player1', 0, 0);
    cav.type = 'infantry'; // 掉马
    cav.hp = 1;
    expect(getDoufanSources(room.unitList, 'player1').map(u => u.id)).toEqual(['c1']);
  });
});

describe('征募范围（纯函数）', () => {
  it('两格内算，三格不算', () => {
    place('src', 'infantry', 'player1', 0, 0);
    civ('d1', 1, 0);
    civ('d2', 2, 0);
    civ('d3', 3, 0);
    expect(getDoufanTargets(room.unitList, 'player1').sort()).toEqual(['d1', 'd2']);
    expect(DOUFAN_RANGE).toBe(2);
  });

  it('按六角最短路径算，不要求视线', () => {
    place('src', 'infantry', 'player1', 0, 0);
    // 把两者之间塞满挡路单位，距离仍然是 2
    place('wall1', 'infantry', 'player2', 1, 0);
    place('wall2', 'infantry', 'player2', 1, -1);
    civ('behind', 2, -1);
    expect(getDoufanTargets(room.unitList, 'player1')).toEqual(['behind']);
  });

  it('多个征募源的范围取并集，同一平民不重复', () => {
    place('s1', 'infantry', 'player1', 0, 0);
    place('s2', 'infantry', 'player1', 2, 0);
    civ('mid', 1, 0); // 两个源都覆盖得到
    expect(getDoufanTargets(room.unitList, 'player1')).toEqual(['mid']);
  });

  it('没有征募源时名单为空', () => {
    taiping('player1', 0, 0);
    civ('c1', 1, 0);
    expect(getDoufanTargets(room.unitList, 'player1')).toEqual([]);
  });

  it('仁德自造的中立标记不是征募目标', () => {
    place('src', 'infantry', 'player1', 0, 0);
    place('n1', 'neutral_marker', 'neutral', 1, 0, { hp: 1, maxHp: 1 });
    expect(getDoufanTargets(room.unitList, 'player1')).toEqual([]);
  });

  it('太平本人站在平民旁边也不构成征募源', () => {
    taiping('player1', 0, 0);
    civ('c1', 1, 0);
    expect(getDoufanTargets(room.unitList, 'player1')).toEqual([]);
  });
});

describe('阶段开始：快照', () => {
  it('把名单快照进 pendingRecruit', () => {
    taiping('player1');
    place('src', 'infantry', 'player1', 0, 0);
    civ('c1', 1, 0);
    civ('c2', 2, 0);
    room.startDoufanPhase('player1');
    expect(queue().sort()).toEqual(['c1', 'c2']);
  });

  it('没有合格目标时不进入强制阶段', () => {
    taiping('player1');
    place('src', 'infantry', 'player1', 0, 0);
    civ('far', 4, 0);
    room.startDoufanPhase('player1');
    expect(queue()).toEqual([]);
    expect(room.rejectIfForcedPhasePending(client('player1'))).toBe(false);
  });

  it('太平阵亡后没有豆饭阶段', () => {
    place('src', 'infantry', 'player1', 0, 0);
    civ('c1', 1, 0);
    room.startDoufanPhase('player1');
    expect(queue()).toEqual([]);
  });

  it('AP 本来就不足 2 时立刻放行，不把玩家锁死', () => {
    taiping('player1');
    place('src', 'infantry', 'player1', 0, 0);
    civ('c1', 1, 0);
    room.state.player1ActionPoints = 1;
    room.startDoufanPhase('player1');
    expect(queue()).toEqual([]);
    expect(room.state.battleLog.some(l => l.includes('行动点不足'))).toBe(true);
  });

  it('接在回合开始流程里：刷新出来的平民立刻成为本回合目标', () => {
    // 要让这条测试真的有判别力，刷新位置必须是确定的：
    // 把交战区填满、只留 (1,0) 一个空格，于是平民必然刷在那里，
    // 而 (1,0) 就在 src(0,0) 的征募范围内。
    taiping('player1', 0, 4);
    place('src', 'infantry', 'player1', 0, 0);
    room.state.player1Taiping.destiny = 9; // 刷新范围 = 交战区 49 格
    room.state.player1DeployedValue = 4;   // 保证掷得出骰子

    let n = 0;
    for (const hex of getCivilianSpawnRange(9, 'player1')) {
      if (hex.q === 0 && hex.r === 0) continue;  // src 自己占着
      if (hex.q === 1 && hex.r === 0) continue;  // 唯一留空
      place(`blk${n++}`, 'infantry', 'player2', hex.q, hex.r);
    }

    room.rollDiceForPlayer('player1');

    const spawned = Array.from(room.state.units.values())
      .filter(u => u.statusTag === CIVILIAN_TAG);
    expect(spawned).toHaveLength(1);
    expect({ q: spawned[0]!.q, r: spawned[0]!.r }).toEqual({ q: 1, r: 0 });
    // 顺序对调（先豆饭后刷新）或者根本没接上，这里都会是空队列
    expect(queue()).toEqual([spawned[0]!.id]);
  });
});

describe('逐个征募', () => {
  /** src 在 (0,0)，平民全部摆在距它 ≤2 的格子上，确保都进名单 */
  const NEAR: Array<[number, number]> = [[1, 0], [2, 0], [0, 1], [0, 2], [-1, 0], [-2, 0]];

  function setup(n: number, ap = 20) {
    taiping('player1');
    place('src', 'infantry', 'player1', 0, 0);
    for (let i = 0; i < n; i++) civ(`c${i}`, NEAR[i]![0], NEAR[i]![1]);
    room.state.player1ActionPoints = ap;
    room.startDoufanPhase('player1');
    // 自检：所有平民都该在名单里，否则下面的断言会测到别的东西
    expect(queue()).toHaveLength(n);
  }

  it('平民变成 2 血力士，扣 2 AP', () => {
    setup(1, 7);
    room.handleTaipingRecruit(client('player1'), { civilianId: 'c0' });
    expect(errors).toEqual([]);
    expect(room.state.units.has('c0')).toBe(false);
    const ls = lishiUnits();
    expect(ls).toHaveLength(1);
    expect(ls[0]!.hp).toBe(2);
    expect(ls[0]!.owner).toBe('player1');
    expect(room.state.player1ActionPoints).toBe(5);
    expect(DOUFAN_COST).toBe(2);
  });

  it('力士出现在原平民的格子上', () => {
    setup(1);
    const before = { q: room.state.units.get('c0')!.q, r: room.state.units.get('c0')!.r };
    room.handleTaipingRecruit(client('player1'), { civilianId: 'c0' });
    const l = lishiUnits()[0]!;
    expect({ q: l.q, r: l.r }).toEqual(before);
  });

  it('新力士当回合不能行动', () => {
    setup(1);
    room.handleTaipingRecruit(client('player1'), { civilianId: 'c0' });
    const l = lishiUnits()[0]!;
    expect(l.actionsThisTurn).toBe(2);
    expect(l.hasMoved).toBe(true);
    expect(l.hasAttacked).toBe(true);
  });

  it('新力士立即计入天命承载量', () => {
    setup(1);
    room.state.player1Taiping.destiny = 0; // 承载 1
    const g = room.state.units.get('g_player1')!;
    place('old', 'huangjin_lishi', 'player1', 0, 3); // 已经有 1 个
    room.handleTaipingRecruit(client('player1'), { civilianId: 'c0' });
    expect(countLishi(room.unitList, 'player1')).toBe(2);

    room.rng = () => 0.5; // 骰子相等，天命不变
    room.settleDestiny('player1');
    expect(g.hp).toBe(2); // 同一回合末就被压掉 1 点
  });

  it('不占用征募源步兵的行动次数', () => {
    setup(1);
    const src = room.state.units.get('src')!;
    room.handleTaipingRecruit(client('player1'), { civilianId: 'c0' });
    expect(src.actionsThisTurn).toBe(0);
    expect(src.hasMoved).toBe(false);
    expect(src.hasAttacked).toBe(false);
  });

  it('顺序由玩家决定', () => {
    setup(3);
    room.handleTaipingRecruit(client('player1'), { civilianId: 'c2' });
    expect(queue().sort()).toEqual(['c0', 'c1']);
    room.handleTaipingRecruit(client('player1'), { civilianId: 'c0' });
    expect(queue()).toEqual(['c1']);
  });

  it('名单外的平民征募不了', () => {
    setup(1);
    civ('outsider', 5, 0);
    room.handleTaipingRecruit(client('player1'), { civilianId: 'outsider' });
    expect(errors).toEqual(['该平民不在本回合的征募名单里']);
    expect(room.state.units.has('outsider')).toBe(true);
  });

  it('AP 不足 2 时自动停止，剩下的平民留在场上', () => {
    setup(4, 7); // 7 点 → 只够征募 3 个
    for (const id of ['c0', 'c1', 'c2']) {
      room.handleTaipingRecruit(client('player1'), { civilianId: id });
    }
    expect(room.state.player1ActionPoints).toBe(1);
    expect(queue()).toEqual([]);
    expect(lishiUnits()).toHaveLength(3);
    expect(room.state.units.has('c3')).toBe(true);
    expect(room.state.battleLog.some(l => l.includes('1 名平民未被征募'))).toBe(true);
  });

  it('不透支：AP 停在 1 而不是变成负数', () => {
    setup(4, 7);
    for (const id of ['c0', 'c1', 'c2', 'c3']) {
      room.handleTaipingRecruit(client('player1'), { civilianId: id });
    }
    expect(room.state.player1ActionPoints).toBe(1);
  });

  it('全部征募完后队列清空', () => {
    setup(2);
    room.handleTaipingRecruit(client('player1'), { civilianId: 'c0' });
    room.handleTaipingRecruit(client('player1'), { civilianId: 'c1' });
    expect(queue()).toEqual([]);
  });

  it('新转化的力士不会扩大本次征募范围（快照语义）', () => {
    taiping('player1');
    place('src', 'infantry', 'player1', 0, 0);
    civ('near', 2, 0);   // 在 src 两格内
    civ('chain', 4, 0);  // 距 src 4 格；但距 near 只有 2 格
    room.startDoufanPhase('player1');
    expect(queue()).toEqual(['near']);

    room.handleTaipingRecruit(client('player1'), { civilianId: 'near' });
    // 新力士站在 (2,0)，chain 在它两格内 —— 但本阶段的名单已经定了
    expect(queue()).toEqual([]);
    expect(room.state.units.has('chain')).toBe(true);
  });

  it('不是自己的回合时拒绝', () => {
    setup(1);
    room.state.currentPlayer = 'player2';
    room.handleTaipingRecruit(client('player1'), { civilianId: 'c0' });
    expect(errors).toEqual(['不是你的回合']);
  });
});

describe('强制：队列非空期间拦住其他指令', () => {
  function setup() {
    taiping('player1', 0, 1);
    place('src', 'infantry', 'player1', 0, 0);
    civ('c0', 1, 0);
    room.startDoufanPhase('player1');
  }

  it('移动指令被拦住，单位没有动', () => {
    setup();
    const src = room.state.units.get('src')!;
    send('player1', 'moveUnit', { unitId: 'src', toQ: -1, toR: 0, toS: 1 });
    expect(errors[0]).toContain('强制豆饭未完成');
    expect({ q: src.q, r: src.r }).toEqual({ q: 0, r: 0 });
  });

  it('结束回合被拦住，回合没有切换', () => {
    setup();
    send('player1', 'endTurn');
    expect(errors[0]).toContain('强制豆饭未完成');
    expect(room.state.currentPlayer).toBe('player1');
  });

  it('符水粥被拦住（同一层拦截，不需要各自加判断）', () => {
    setup();
    civ('adj', 1, 1); // 挨着太平 (0,1)
    send('player1', 'taipingFushui', { civilianId: 'adj' });
    expect(errors[0]).toContain('强制豆饭未完成');
    expect(room.state.units.has('adj')).toBe(true);
  });

  it('部署被拦住', () => {
    setup();
    send('player1', 'deployUnit', { unitType: 'infantry', position: { q: 0, r: 5, s: -5 } });
    expect(errors[0]).toContain('强制豆饭未完成');
  });

  it('拦截会报出还剩几名', () => {
    setup();
    send('player1', 'endTurn');
    expect(errors[0]).toContain('还有 1 名平民等待征募');
  });

  it('征募指令本身在豁免名单里，否则就死锁了', () => {
    setup();
    send('player1', 'taipingRecruit', { civilianId: 'c0' });
    expect(errors).toEqual([]);
    expect(lishiUnits()).toHaveLength(1);
  });

  it('认输永远不被拦', () => {
    setup();
    send('player1', 'surrender');
    expect(errors).toEqual([]);
    expect(room.state.phase).toBe('end');
  });

  it('征募完之后其他指令放行', () => {
    setup();
    send('player1', 'taipingRecruit', { civilianId: 'c0' });
    errors.length = 0;
    send('player1', 'endTurn');
    expect(errors).toEqual([]);
    expect(room.state.currentPlayer).toBe('player2');
  });

  it('对手的指令不被这层拦（照常回「不是你的回合」）', () => {
    setup();
    send('player2', 'endTurn');
    expect(errors).toEqual(['不是你的回合']);
  });

  it('所有玩家指令都走同一个拦截层', () => {
    // 一条都不能漏：漏掉的那条就是一条绕过强制征募的后门，
    // 而且往往只在特定兵种 / 特定技能下才暴露
    setup();
    const types = registeredTypes();
    expect(types.length).toBe(31);
    const exempt = ['taipingRecruit', 'surrender'];
    for (const type of types) {
      if (exempt.includes(type)) continue;
      errors.length = 0;
      send('player1', type, {});
      expect(errors[0], `指令 ${type} 没有被强制阶段拦住`).toContain('强制豆饭未完成');
    }
  });
});

describe('双太平', () => {
  it('两方各有独立的征募队列', () => {
    room = newGame('taiping', 'taiping');
    taiping('player1', 0, 4);
    taiping('player2', 0, -4);
    place('s1', 'infantry', 'player1', 0, 1);
    place('s2', 'infantry', 'player2', 0, -1);
    civ('shared', 0, 0); // 两边都在两格内

    room.startDoufanPhase('player1');
    expect(Array.from(room.state.player1Taiping.pendingRecruit)).toEqual(['shared']);
    expect(Array.from(room.state.player2Taiping.pendingRecruit)).toEqual([]);

    room.startDoufanPhase('player2');
    expect(Array.from(room.state.player2Taiping.pendingRecruit)).toEqual(['shared']);
  });

  it('被一方征募掉之后，另一方的名单里就没了', () => {
    room = newGame('taiping', 'taiping');
    taiping('player1', 0, 4);
    taiping('player2', 0, -4);
    place('s1', 'infantry', 'player1', 0, 1);
    place('s2', 'infantry', 'player2', 0, -1);
    civ('shared', 0, 0);

    room.startDoufanPhase('player1');
    room.handleTaipingRecruit(client('player1'), { civilianId: 'shared' });

    room.state.currentPlayer = 'player2';
    room.startDoufanPhase('player2');
    expect(Array.from(room.state.player2Taiping.pendingRecruit)).toEqual([]);
  });
});
