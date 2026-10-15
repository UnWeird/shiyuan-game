import { beforeEach, describe, expect, it } from 'vitest';
import { ShiyuanRoom } from '../rooms/ShiyuanRoom';
import { GameStateSchema, UnitSchema } from '../schema/GameState';
import {
  CIVILIAN_TAG,
  getCorruptCandidates,
  getCorruptTargets,
  wouldTriggerZuoluan,
  type UnitLike,
} from '../../../shared/rules/queries';

/**
 * 太平 · 腐化
 *
 * 和豆饭同构（快照 + 拦截 + 逐个处理），但结束条件不同：
 * 腐化不花行动点，所以不会「付不起」，只会「没得腐化」。
 *
 * 真正的关键是**腐化与作乱共用同一个充能开关** ——
 * 腐化完就不能作乱，作乱完也不能腐化，除非重新移动充满。
 */

type RoomProbe = {
  state: GameStateSchema;
  setState: (s: GameStateSchema) => void;
  rng: () => number;
  unitList: UnitLike[];
  startCorruptPhase: (role: 'player1' | 'player2') => void;
  handleTaipingCorrupt: (c: unknown, d: { zeiId: string; civilianId: string }) => void;
  applyZuoluan: (u: UnitSchema) => boolean;
  settleDestiny: (role: 'player1' | 'player2') => void;
  refreshCivilians: (role: 'player1' | 'player2') => void;
  rollDiceForPlayer: (role: 'player1' | 'player2') => void;
  handleEndTurn: (c: unknown) => void;
  handleMoveUnit: (c: unknown, d: { unitId: string; toQ: number; toR: number; toS: number }) => void;
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

/** player1 选了太平但场上没有太平将军 = 已阵亡，所以走腐化而不是豆饭 */
function newGame(): RoomProbe {
  const r = new ShiyuanRoom() as unknown as RoomProbe;
  r.setState(new GameStateSchema());
  r.state.phase = 'action';
  r.state.currentPlayer = 'player1';
  r.state.player1General = 'taiping';
  r.state.player2General = 'wushuang';
  r.state.player1ActionPoints = 20;
  r.state.player2ActionPoints = 20;
  r.state.player1DeployedValue = 4;
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

const zei = (id: string, q: number, r: number, charged = true, owner: 'player1' | 'player2' = 'player1') =>
  place(id, 'huangjin_zei', owner, q, r, { hp: 2, maxHp: 2, charged });

const civ = (id: string, q: number, r: number) =>
  place(id, 'neutral_marker', 'neutral', q, r, { hp: 1, maxHp: 1, statusTag: CIVILIAN_TAG });

const U = (u: UnitSchema) => u as unknown as UnitLike;
const queue = () => Array.from(room.state.player1Taiping.pendingCorrupt);
const zeiUnits = () =>
  Array.from(room.state.units.values()).filter(u => u.type === 'huangjin_zei');

beforeEach(() => {
  errors.length = 0;
  room = newGame();
});

describe('候选与目标（纯函数）', () => {
  it('充能且相邻平民的己方贼才是候选', () => {
    zei('ok', 0, 0, true);            // 挨着 c1
    zei('drained', 2, 0, false);      // 挨着 c1 但充能耗尽
    zei('lonely', 0, -4, true);       // 充能满但方圆两格没有平民
    zei('enemy', -2, 0, true, 'player2'); // 挨着 c3 但不是己方
    civ('c1', 1, 0);
    civ('c3', -3, 0);
    expect(getCorruptCandidates(room.unitList, 'player1')).toEqual(['ok']);
  });

  it('场上没有平民时没有候选', () => {
    zei('z', 0, 0);
    expect(getCorruptCandidates(room.unitList, 'player1')).toEqual([]);
  });

  it('只腐化相邻的平民，距离 2 不行', () => {
    const z = zei('z', 0, 0);
    civ('near', 1, 0);
    civ('far', 2, 0);
    expect(getCorruptTargets(U(z), room.unitList)).toEqual(['near']);
  });

  it('耗尽的贼没有可腐化目标', () => {
    const z = zei('z', 0, 0, false);
    civ('c', 1, 0);
    expect(getCorruptTargets(U(z), room.unitList)).toEqual([]);
  });

  it('仁德自造的中立标记不是腐化目标', () => {
    const z = zei('z', 0, 0);
    place('n', 'neutral_marker', 'neutral', 1, 0, { hp: 1, maxHp: 1 });
    expect(getCorruptTargets(U(z), room.unitList)).toEqual([]);
  });

  it('一只贼可以有多个可选目标', () => {
    const z = zei('z', 0, 0);
    civ('a', 1, 0);
    civ('b', 0, 1);
    expect(getCorruptTargets(U(z), room.unitList).sort()).toEqual(['a', 'b']);
  });
});

describe('阶段开始', () => {
  it('把候选快照进 pendingCorrupt', () => {
    zei('z1', 0, 0);
    zei('z2', 2, 0);
    civ('c1', 1, 0); // z1、z2 都挨着它
    room.startCorruptPhase('player1');
    expect(queue().sort()).toEqual(['z1', 'z2']);
  });

  it('太平还活着时不开腐化阶段（那时走豆饭）', () => {
    place('g', 'general', 'player1', 0, 4, { generalType: 'taiping', hp: 3, maxHp: 3 });
    zei('z', 0, 0);
    civ('c', 1, 0);
    room.startCorruptPhase('player1');
    expect(queue()).toEqual([]);
  });

  it('没选太平的一方不开腐化阶段', () => {
    zei('z', 0, 0, true, 'player2');
    civ('c', 1, 0);
    room.startCorruptPhase('player2');
    expect(Array.from(room.state.player2Taiping.pendingCorrupt)).toEqual([]);
  });

  it('接在回合开始流程里（§7.2 第 3 步，刷新之后）', () => {
    zei('z', 0, 0);
    // 把交战区填满只留一格，让刷新落点确定且挨着贼
    room.state.player1Taiping.destiny = 9;
    const free = { q: 1, r: 0 };
    let n = 0;
    for (let q = -5; q <= 5; q++) {
      for (let r = -2; r <= 2; r++) {
        const s = -q - r;
        if (Math.abs(q) > 5 || Math.abs(r) > 5 || Math.abs(s) > 5) continue;
        if (q === 0 && r === 0) continue;
        if (q === free.q && r === free.r) continue;
        place(`blk${n++}`, 'infantry', 'player2', q, r);
      }
    }
    room.rollDiceForPlayer('player1');
    const spawned = Array.from(room.state.units.values()).find(u => u.statusTag === CIVILIAN_TAG)!;
    expect({ q: spawned.q, r: spawned.r }).toEqual(free);
    expect(queue()).toEqual(['z']); // 刷出来的平民立刻让贼进了腐化名单
  });
});

describe('执行腐化', () => {
  function setup() {
    zei('z', 0, 0);
    civ('c', 1, 0);
    room.startCorruptPhase('player1');
  }

  it('平民变成 1 血、充能充满的黄巾贼', () => {
    setup();
    send('player1', 'taipingCorrupt', { zeiId: 'z', civilianId: 'c' });
    expect(errors).toEqual([]);
    expect(room.state.units.has('c')).toBe(false);
    const born = zeiUnits().find(u => u.id !== 'z')!;
    expect(born.hp).toBe(1);
    expect(born.maxHp).toBe(2);
    expect(born.charged).toBe(true);
    expect(born.owner).toBe('player1');
    expect({ q: born.q, r: born.r }).toEqual({ q: 1, r: 0 });
  });

  it('施术的贼耗尽充能', () => {
    setup();
    send('player1', 'taipingCorrupt', { zeiId: 'z', civilianId: 'c' });
    expect(room.state.units.get('z')!.charged).toBe(false);
  });

  it('不消耗行动点，也不消耗天命', () => {
    setup();
    room.state.player1Taiping.destiny = 6;
    send('player1', 'taipingCorrupt', { zeiId: 'z', civilianId: 'c' });
    expect(room.state.player1ActionPoints).toBe(20);
    expect(room.state.player1Taiping.destiny).toBe(6);
  });

  it('新贼当回合不能主动移动', () => {
    setup();
    send('player1', 'taipingCorrupt', { zeiId: 'z', civilianId: 'c' });
    const born = zeiUnits().find(u => u.id !== 'z')!;
    expect(born.hasMoved).toBe(true);
    expect(born.actionsThisTurn).toBe(2);
  });

  it('非相邻的平民腐化不了', () => {
    zei('z', 0, 0);
    civ('near', 1, 0);
    civ('far', 3, 0);
    room.startCorruptPhase('player1');
    send('player1', 'taipingCorrupt', { zeiId: 'z', civilianId: 'far' });
    expect(errors).toEqual(['只能腐化与该黄巾贼相邻的平民']);
    expect(room.state.units.has('far')).toBe(true);
  });

  it('名单外的贼腐化不了', () => {
    setup();
    zei('outsider', 3, 0);
    civ('c2', 4, 0);
    send('player1', 'taipingCorrupt', { zeiId: 'outsider', civilianId: 'c2' });
    expect(errors).toEqual(['该黄巾贼不在本回合的腐化名单里']);
  });

  it('同一平民只能被腐化一次', () => {
    zei('a', 0, 0);
    zei('b', 2, 0);
    civ('shared', 1, 0);
    room.startCorruptPhase('player1');
    expect(queue().sort()).toEqual(['a', 'b']);

    send('player1', 'taipingCorrupt', { zeiId: 'a', civilianId: 'shared' });
    // b 没有别的目标了，自动跳过
    expect(queue()).toEqual([]);
    expect(room.state.units.get('b')!.charged).toBe(true); // 没用掉充能
  });

  it('多只贼可以各自腐化不同平民', () => {
    zei('a', 0, 0);
    zei('b', 3, 0);
    civ('ca', 1, 0);
    civ('cb', 4, 0);
    room.startCorruptPhase('player1');
    send('player1', 'taipingCorrupt', { zeiId: 'a', civilianId: 'ca' });
    send('player1', 'taipingCorrupt', { zeiId: 'b', civilianId: 'cb' });
    expect(errors).toEqual([]);
    expect(queue()).toEqual([]);
    expect(zeiUnits()).toHaveLength(4);
  });

  it('目标顺序由玩家决定', () => {
    const z = zei('z', 0, 0);
    civ('a', 1, 0);
    civ('b', 0, 1);
    room.startCorruptPhase('player1');
    send('player1', 'taipingCorrupt', { zeiId: 'z', civilianId: 'b' });
    expect(room.state.units.has('b')).toBe(false);
    expect(room.state.units.has('a')).toBe(true); // 一只贼只能腐化一个
    expect(z.charged).toBe(false);
  });

  it('新腐化的贼不参与本次判定（不会同回合无限连锁）', () => {
    zei('z', 0, 0);
    civ('c1', 1, 0);
    civ('c2', 2, 0); // 与 c1 相邻；c1 变贼后本会够到它
    room.startCorruptPhase('player1');
    expect(queue()).toEqual(['z']);

    send('player1', 'taipingCorrupt', { zeiId: 'z', civilianId: 'c1' });
    expect(queue()).toEqual([]);
    expect(room.state.units.has('c2')).toBe(true);
  });

  it('不是自己的回合时拒绝', () => {
    setup();
    room.state.currentPlayer = 'player2';
    send('player1', 'taipingCorrupt', { zeiId: 'z', civilianId: 'c' });
    expect(errors).toEqual(['不是你的回合']);
  });
});

describe('腐化与作乱共用充能', () => {
  it('腐化之后不能立刻作乱', () => {
    zei('z', 0, 0);
    civ('c', 1, 0);
    room.startCorruptPhase('player1');
    send('player1', 'taipingCorrupt', { zeiId: 'z', civilianId: 'c' });

    // 受害者要挨着 z 但**不**挨着新生的那只贼（它站在 (1,0) 且充能是满的），
    // 否则测到的是新贼的作乱而不是「z 的充能已经用掉了」
    const victim = place('v', 'infantry', 'player2', -1, 0);
    expect(wouldTriggerZuoluan(U(victim), room.unitList)).toBe(false);
    expect(room.applyZuoluan(victim)).toBe(false);
    expect(victim.hp).toBe(2);
  });

  it('作乱之后不能腐化', () => {
    const z = zei('z', 0, 0);
    civ('c', 1, 0);
    const victim = place('v', 'infantry', 'player2', 0, 1);
    room.applyZuoluan(victim);          // 把 z 的充能用掉
    expect(z.charged).toBe(false);

    room.startCorruptPhase('player1');
    expect(queue()).toEqual([]);        // 已经不是候选
  });

  it('移动充满之后，下一个腐化阶段又能腐化', () => {
    const z = zei('z', 0, 0, false);
    civ('c', 1, 0);
    room.startCorruptPhase('player1');
    expect(queue()).toEqual([]);

    // 移动一步回充。落点要仍然挨着平民 (1,0)：(1,-1) 距它 1 格，(0,-1) 距它 2 格
    room.handleMoveUnit(client('player1'), { unitId: z.id, toQ: 1, toR: -1, toS: 0 });
    expect(z.charged).toBe(true);

    room.startCorruptPhase('player1');
    expect(queue()).toEqual(['z']);
  });

  it('新腐化出的贼充能是满的，对手回合就能作乱', () => {
    zei('z', 0, 0);
    civ('c', 1, 0);
    room.startCorruptPhase('player1');
    send('player1', 'taipingCorrupt', { zeiId: 'z', civilianId: 'c' });

    // 新贼站在 (1,0)，相邻的 (2,0) 就处在它的作乱范围里
    const victim = place('v', 'infantry', 'player2', 2, 0);
    expect(wouldTriggerZuoluan(U(victim), room.unitList)).toBe(true);
  });
});

describe('强制：队列非空期间拦住其他指令', () => {
  function setup() {
    zei('z', 0, 0);
    civ('c', 1, 0);
    room.startCorruptPhase('player1');
  }

  it('结束回合被拦住', () => {
    setup();
    send('player1', 'endTurn');
    expect(errors[0]).toContain('强制腐化未完成');
    expect(room.state.currentPlayer).toBe('player1');
  });

  it('移动被拦住', () => {
    setup();
    const other = zei('other', 4, 0);
    send('player1', 'moveUnit', { unitId: other.id, toQ: 5, toR: 0, toS: -5 });
    expect(errors[0]).toContain('强制腐化未完成');
    expect({ q: other.q, r: other.r }).toEqual({ q: 4, r: 0 });
  });

  it('拦截会报出还剩几只', () => {
    setup();
    send('player1', 'endTurn');
    expect(errors[0]).toContain('还有 1 名黄巾贼');
  });

  it('腐化指令本身在豁免名单里', () => {
    setup();
    send('player1', 'taipingCorrupt', { zeiId: 'z', civilianId: 'c' });
    expect(errors).toEqual([]);
  });

  it('处理完之后放行', () => {
    setup();
    send('player1', 'taipingCorrupt', { zeiId: 'z', civilianId: 'c' });
    errors.length = 0;
    send('player1', 'endTurn');
    expect(errors).toEqual([]);
    expect(room.state.currentPlayer).toBe('player2');
  });
});

describe('§7.1 末尾：太平死于天命难承时立即腐化', () => {
  function overloadedTaiping() {
    const g = place('g', 'general', 'player1', 0, 4, { generalType: 'taiping', hp: 1, maxHp: 3 });
    room.state.player1Taiping.destiny = 0; // 承载 1
    place('l1', 'huangjin_lishi', 'player1', 0, 0);
    place('l2', 'huangjin_lishi', 'player1', -1, 0);
    civ('c', 1, 0); // 挨着 l1
    room.rng = () => 0.5; // 骰子相等，天命不变
    return g;
  }

  it('天命难承压死太平 → 起义 + 立刻进入腐化阶段', () => {
    const g = overloadedTaiping();
    room.settleDestiny('player1');
    expect(room.state.units.has(g.id)).toBe(false);
    expect(room.state.units.get('l1')!.type).toBe('huangjin_zei');
    expect(queue()).toEqual(['l1']); // 只有 l1 挨着平民
  });

  it('回合结束被挂住，完成腐化后才真的结束', () => {
    overloadedTaiping();
    room.handleEndTurn(client('player1'));
    expect(room.state.currentPlayer).toBe('player1'); // 没切换
    expect(queue()).toEqual(['l1']);

    send('player1', 'taipingCorrupt', { zeiId: 'l1', civilianId: 'c' });
    room.handleEndTurn(client('player1'));
    expect(room.state.currentPlayer).toBe('player2');
  });

  it('被挂住时不会把「上回合是否击杀」刷掉两遍', () => {
    overloadedTaiping();
    room.state.player1KilledThisTurn = true;

    room.handleEndTurn(client('player1'));   // 被腐化挂住
    expect(room.state.player1KilledThisTurn).toBe(true); // 还没重置

    send('player1', 'taipingCorrupt', { zeiId: 'l1', civilianId: 'c' });
    room.handleEndTurn(client('player1'));
    expect(room.state.player1KilledLastTurn).toBe(true);
    expect(room.state.player1KilledThisTurn).toBe(false);
  });

  it('太平在对手回合被打死时不立刻腐化（等自己回合开始）', () => {
    const g = place('g', 'general', 'player1', 0, 4, { generalType: 'taiping', hp: 1, maxHp: 3 });
    place('l1', 'huangjin_lishi', 'player1', 0, 0);
    civ('c', 1, 0);
    room.state.currentPlayer = 'player2';

    const a = place('a', 'infantry', 'player2', 1, 4);
    room.onMessageHandlers['attackUnit']!.callback(client('player2'), {
      attackerId: a.id, targetId: g.id,
    });

    expect(room.state.units.has(g.id)).toBe(false);
    expect(room.state.units.get('l1')!.type).toBe('huangjin_zei');
    expect(queue()).toEqual([]); // 对手回合里不开腐化阶段
  });
});
