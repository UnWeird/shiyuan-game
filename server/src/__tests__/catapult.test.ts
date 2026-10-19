import { beforeEach, describe, expect, it } from 'vitest';
import { ShiyuanRoom } from '../rooms/ShiyuanRoom';
import { GameStateSchema, UnitSchema } from '../schema/GameState';
import { Direction } from '../../../shared/types';
import { getShootingPath } from '../../../shared/utils/hexUtils';
import { occupiedHexesOf, type UnitLike } from '../../../shared/rules/queries';

/**
 * 神机 · 投石车
 *
 * 这个兵种是后加的，而三处分支（部署费用、库存校验、库存扣减）都是
 * `if (ballista) ... else if (chariot) ...` 的形状 —— 投石车要么落进战车那支、
 * 要么两支都不进。于是它曾经：按战车收 4 点、**完全不扣兵力库存**、
 * 部署价值算 0 元、炮口朝东而不是朝敌方。
 *
 * 功能侧的缺口同源：「每种行动一回合一次」这条基础规则（GAMEPLAY.md「行动限制」）
 * 靠 hasMoved / hasAttacked / hasRotated 三个标记实现，而蓄力一直没有标记，
 * 是唯一能在一回合里做两次的行动 —— 两次就直接满层。
 *
 * 所以这一组盯的是「费用真的扣了」和「档位真的分三档」。
 */

type RoomProbe = {
  state: GameStateSchema;
  setState: (s: GameStateSchema) => void;
  unitList: UnitLike[];
  getPlayerRole: (c: unknown) => 'player1' | 'player2' | null;
  registerMessageHandlers: () => void;
  onMessageHandlers: Record<string, { callback: (c: unknown, d: unknown) => void }>;
  getValidMoves: (u: UnitSchema) => { q: number; r: number; s: number }[];
  buildValidActions: (role: 'player1' | 'player2') => unknown;
};

let room: RoomProbe;
let errors: string[];

const client = (role: 'player1' | 'player2') => ({
  sessionId: role,
  send: (type: string, data: { message?: string }) => {
    if (type === 'error') errors.push(data.message ?? '');
  },
});

/** 按消息名走真实注册的处理器 */
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
const ap = (role: 'player1' | 'player2') =>
  role === 'player1' ? room.state.player1ActionPoints : room.state.player2ActionPoints;

/** 神机将军 —— 部署机关的前置条件 */
function shenji(role: 'player1' | 'player2' = 'player1', q = 0, r = 5) {
  return place(`gen_${role}`, 'general', role, q, r, { generalType: 'shenji', hp: 3, maxHp: 3 });
}

beforeEach(() => {
  errors = [];
  room = new ShiyuanRoom() as unknown as RoomProbe;
  room.setState(new GameStateSchema());
  room.state.phase = 'action';
  room.state.currentPlayer = 'player1';
  room.state.player1General = 'shenji';
  room.state.player2General = 'wushuang';
  room.state.player1ActionPoints = 20;
  room.state.player2ActionPoints = 20;
  room.state.player1BaseQ = 0; room.state.player1BaseR = 5; room.state.player1BaseS = -5;
  room.state.player2BaseQ = 0; room.state.player2BaseR = -5; room.state.player2BaseS = 5;
  // 兵力库存（部署机关要从这里扣）
  room.state.player1Infantry = 10;
  room.state.player1Archer = 4;
  room.state.player2Infantry = 10;
  room.state.player2Archer = 4;
  room.getPlayerRole = (c: unknown) => (c as { sessionId: string }).sessionId as 'player1' | 'player2';
  room.registerMessageHandlers();
});

describe('部署费用与库存', () => {
  it('投石车：3 点行动值 + 2 步兵 + 1 弓箭手，部署价值 0.7 元', () => {
    shenji();
    const before = ap('player1');

    // 机关只能部署在中间排：玩家1 是 r = 4
    send('player1', 'shenjiDeployMachine', { machineType: 'catapult', position: { q: -1, r: 4, s: -3 } });

    expect(errors).toEqual([]);
    expect(before - ap('player1')).toBe(3);
    expect(room.state.player1ConsumedInfantry).toBe(2);
    expect(room.state.player1ConsumedArcher).toBe(1);
    // 部署价值直接决定对手下回合的骰子数（每 2 元 1 颗），原来投石车算 0 元
    expect(room.state.player1DeployedValue).toBeCloseTo(0.7);
  });

  it('库存不足时拒绝部署，且不扣行动点', () => {
    shenji();
    room.state.player1Archer = 0;
    const before = ap('player1');

    send('player1', 'shenjiDeployMachine', { machineType: 'catapult', position: { q: -1, r: 4, s: -3 } });

    expect(errors[0]).toContain('兵力库存不足');
    expect(ap('player1')).toBe(before);
    expect(room.state.player1ConsumedInfantry).toBe(0);
  });

  it('行动点不足时拒绝部署', () => {
    shenji();
    room.state.player1ActionPoints = 2;

    send('player1', 'shenjiDeployMachine', { machineType: 'catapult', position: { q: -1, r: 4, s: -3 } });

    expect(errors[0]).toBe('行动点不足（需要3点）');
    expect(room.state.player1ConsumedInfantry).toBe(0);
  });

  it('弩车 5 点 + 4步1弓；战车 4 点 + 6 步', () => {
    shenji('player1', 3, 0); // 挪开，免得挡住下面两台机关的车身格
    const before = ap('player1');
    send('player1', 'shenjiDeployMachine', { machineType: 'ballista', position: { q: -3, r: 4, s: -1 } });
    expect(errors).toEqual([]);
    expect(before - ap('player1')).toBe(5);
    expect(room.state.player1ConsumedInfantry).toBe(4);
    expect(room.state.player1ConsumedArcher).toBe(1);

    // 战车 0.6 元 = 6 个一角：4 个在场上占格，另 2 个压在车里，
    // 崩解时爆出来的那两个步兵就是它们。原来这里只扣 4，和 getUnitValue
    // 的 0.6、GAMEPLAY 的 0.6 元、战报里的「6步兵」三处都对不上
    const mid = ap('player1');
    send('player1', 'shenjiDeployMachine', { machineType: 'chariot', position: { q: 0, r: 4, s: -4 } });
    expect(errors).toEqual([]);
    expect(mid - ap('player1')).toBe(4);
    expect(room.state.player1ConsumedInfantry).toBe(4 + 6);
    // 战车不吃弓箭手库存
    expect(room.state.player1ConsumedArcher).toBe(1);
  });

  it('战车崩解生成的 2 个步兵不再另扣库存（已经预付在 6 个一角里）', () => {
    shenji('player1', 3, 0);
    send('player1', 'shenjiDeployMachine', { machineType: 'chariot', position: { q: 0, r: 4, s: -4 } });
    expect(room.state.player1ConsumedInfantry).toBe(6);

    const chariot = Array.from(room.state.units.values()).find(u => u.type === 'chariot')!;
    const before = room.state.player1ConsumedInfantry;
    (room as unknown as { handleChariotDeath: (c: unknown) => void }).handleChariotDeath(chariot);

    expect(room.state.player1ConsumedInfantry).toBe(before);
    const infantry = Array.from(room.state.units.values()).filter(u => u.type === 'infantry' && u.owner === 'player1');
    expect(infantry).toHaveLength(2);
  });
});

describe('部署时的初始朝向', () => {
  /**
   * 弩车用 NORTH(6)/SOUTH(7)，但这两个值不是 HEX_DIRECTIONS 的下标
   *（那个数组只有 6 项）。弩车能用是因为它走 getBallistaVerticalPath。
   * 投石车走 getShootingPath → hexNeighbor，拿到 6 会读出 undefined 直接抛异常。
   */
  it.each([
    ['player1' as const, 4, Direction.NORTH_EAST],
    ['player2' as const, -4, Direction.SOUTH_WEST],
  ])('%s 部署的投石车炮口朝敌方，且朝向在 0~5 内', (role, middleRow, expected) => {
    room.state.currentPlayer = role;
    room.state[role === 'player1' ? 'player1General' : 'player2General'] = 'shenji';
    shenji(role, 0, middleRow + (role === 'player1' ? 1 : -1));

    send(role, 'shenjiDeployMachine', { machineType: 'catapult', position: { q: -1, r: middleRow, s: 1 - middleRow } });

    expect(errors).toEqual([]);
    const cat = Array.from(room.state.units.values()).find(u => u.type === 'catapult')!;
    expect(cat.direction).toBe(expected);
    expect(cat.direction).toBeLessThan(6);
    // 真正要防的是这个：拿 6 当下标会抛异常
    expect(() => getShootingPath({ q: cat.q, r: cat.r, s: cat.s }, cat.direction, 5)).not.toThrow();
  });
});

describe('蓄力：每种行动一回合一次', () => {
  const cat = () =>
    place('cat', 'catapult', 'player1', 0, 0, { hp: 4, maxHp: 4, direction: Direction.EAST });

  it('一回合只能蓄力一次', () => {
    cat();
    send('player1', 'catapultCharge', { catapultId: 'cat' });
    expect(errors).toEqual([]);
    expect(unit('cat')!.chargeLevel).toBe(1);

    send('player1', 'catapultCharge', { catapultId: 'cat' });
    expect(errors).toEqual(['投石车本回合已蓄力过']);
    expect(unit('cat')!.chargeLevel).toBe(1);
  });

  it('跨回合可以蓄到满层', () => {
    cat();
    send('player1', 'catapultCharge', { catapultId: 'cat' });
    unit('cat')!.hasCharged = false; // 模拟回合结束的重置
    unit('cat')!.actionsThisTurn = 0;
    send('player1', 'catapultCharge', { catapultId: 'cat' });

    expect(errors).toEqual([]);
    expect(unit('cat')!.chargeLevel).toBe(2);
  });

  it('满层后不能再蓄', () => {
    cat().chargeLevel = 2;
    send('player1', 'catapultCharge', { catapultId: 'cat' });
    expect(errors).toEqual(['投石车已达到最大蓄力层数']);
  });

  it('回合结束重置 hasCharged', () => {
    cat();
    send('player1', 'catapultCharge', { catapultId: 'cat' });
    expect(unit('cat')!.hasCharged).toBe(true);

    send('player1', 'endTurn');
    expect(unit('cat')!.hasCharged).toBe(false);
    // 层数**不**重置 —— 蓄力的意义就在于跨回合累积
    expect(unit('cat')!.chargeLevel).toBe(1);
  });
});

describe('开火', () => {
  /** 投石车在原点朝东，目标在正东 2 格 */
  function setup(chargeLevel: number) {
    const cat = place('cat', 'catapult', 'player1', 0, 0, {
      hp: 4, maxHp: 4, direction: Direction.EAST, chargeLevel,
    });
    const target = place('t', 'infantry', 'player2', 2, 0, { hp: 2, maxHp: 2 });
    return { cat, target };
  }

  it('开火清零全部蓄力层数（不是 -1 层）', () => {
    // -1 层配上「一回合两个行动」会退化成：开火那回合顺手再蓄一层，
    // 于是永远停在满层，0/1/2 三档里只有 2 层会被用到
    setup(2);
    send('player1', 'attackUnit', { attackerId: 'cat', targetId: 't' });

    expect(errors).toEqual([]);
    expect(unit('cat')!.chargeLevel).toBe(0);
  });

  it('0 层：主目标 + 背后 1 格各 1 点', () => {
    setup(0);
    const behind = place('b', 'infantry', 'player2', 3, 0, { hp: 2, maxHp: 2 });

    send('player1', 'attackUnit', { attackerId: 'cat', targetId: 't' });

    expect(unit('t')!.hp).toBe(1);
    expect(behind.hp).toBe(1);
  });

  it('2 层：目标周围 6 格全部受溅射，含攻击者这一侧', () => {
    setup(2);
    // 目标在 (2,0)，它的六个邻格
    place('n0', 'infantry', 'player2', 3, 0, { hp: 2, maxHp: 2 });   // 更远（东）
    place('n1', 'infantry', 'player2', 1, 0, { hp: 2, maxHp: 2 });   // 更近（西）—— 攻击者这一侧
    place('n2', 'infantry', 'player2', 2, -1, { hp: 2, maxHp: 2 });

    send('player1', 'attackUnit', { attackerId: 'cat', targetId: 't' });

    expect(unit('t')!.hp).toBe(1);
    expect(unit('n0')!.hp).toBe(1);
    expect(unit('n1')!.hp).toBe(1);
    expect(unit('n2')!.hp).toBe(1);
  });

  it('溅射带友伤，平民照伤', () => {
    setup(2);
    const friend = place('f', 'infantry', 'player1', 3, 0, { hp: 2, maxHp: 2 });
    const civ = place('c', 'neutral_marker', 'neutral', 2, -1, { hp: 1, maxHp: 1, statusTag: 'civilian' });

    send('player1', 'attackUnit', { attackerId: 'cat', targetId: 't' });

    expect(friend.hp).toBe(1);
    expect(unit('c')).toBeUndefined(); // 1 血平民被溅射击杀
  });

  it('溅射打到机关的车身格，且同一台机关只扣一次血', () => {
    // 原来只比中心格，机关的车身格溅射完全打不到；
    // 而 2 层的 360° 可能同时覆盖同一台机关的两三格车身，按格子算会重复扣血
    setup(2);
    const foe = place('ball', 'ballista', 'player2', 3, 0, {
      hp: 4, maxHp: 4, direction: 7,
    });
    const body = occupiedHexesOf(foe as unknown as UnitLike);
    expect(body.length).toBe(3); // 中心 + 两格车身

    send('player1', 'attackUnit', { attackerId: 'cat', targetId: 't' });

    expect(unit('ball')!.hp).toBe(3); // 正好 1 点，不是 2~3 点
  });

  it('开火后不能再开火，但仍可蓄力（不同种行动）', () => {
    setup(0);
    send('player1', 'attackUnit', { attackerId: 'cat', targetId: 't' });
    expect(errors).toEqual([]);

    send('player1', 'attackUnit', { attackerId: 'cat', targetId: 't' });
    expect(errors).toEqual(['该单位本回合已攻击过']);

    errors = [];
    send('player1', 'catapultCharge', { catapultId: 'cat' });
    expect(errors).toEqual([]);
    expect(unit('cat')!.chargeLevel).toBe(1);
  });
});

describe('车体', () => {
  it('近战打投石车伤害 +1（4 血挨两下就拆）', () => {
    const cat = place('cat', 'catapult', 'player2', 0, 0, { hp: 4, maxHp: 4, direction: Direction.SOUTH_WEST });
    // 投石车的车身朝玩家2 的敌方（南），所以从北边贴上去打中心格
    place('inf', 'infantry', 'player1', 1, 0, { hp: 2, maxHp: 2 });

    send('player1', 'attackUnit', { attackerId: 'inf', targetId: 'cat' });

    expect(errors).toEqual([]);
    expect(cat.hp).toBe(2);
  });

  it('战车不受「近战 +1」（规则书没给它这条）', () => {
    const ch = place('ch', 'chariot', 'player2', 0, 0, { hp: 4, maxHp: 4 });
    place('inf', 'infantry', 'player1', -1, 0, { hp: 2, maxHp: 2 });

    send('player1', 'attackUnit', { attackerId: 'inf', targetId: 'ch' });

    expect(errors).toEqual([]);
    expect(ch.hp).toBe(3);
  });

  it('车身格挡住其他单位的移动', () => {
    // isHexOccupiedByMachine 原来没有 catapult 分支，任何单位都能站进 V 形车身里
    const cat = place('cat', 'catapult', 'player1', 0, 0, { hp: 4, maxHp: 4 });
    const body = occupiedHexesOf(cat as unknown as UnitLike).slice(1);
    expect(body.length).toBe(2);

    const inf = place('inf', 'infantry', 'player1', body[0]!.q, body[0]!.r + 1);
    const moves = room.getValidMoves(inf);

    for (const b of body) {
      expect(moves.some(m => m.q === b.q && m.r === b.r), `车身格 (${b.q},${b.r}) 不该是合法落点`).toBe(false);
    }
  });
});

describe('仁德招降投石车', () => {
  it('转化后的朝向合法，不会把房间带崩', () => {
    // 原来这里设成 NORTH(6)，而 HEX_DIRECTIONS 只有 6 项 ——
    // 之后任何 getShootingPath 都会在 hexNeighbor 里读到 undefined 抛异常，
    // 把整个 buildValidActions 带崩，招降一台投石车就能让房间不可用
    room.state.player1General = 'rende';
    const rende = place('rende', 'general', 'player1', 0, 0, { generalType: 'rende', hp: 4, maxHp: 4, canConvertNeutral: true });
    expect(rende.abilityUsed).toBe(false);
    place('cat', 'catapult', 'player2', 1, 0, { hp: 4, maxHp: 4, direction: Direction.SOUTH_WEST });

    send('player1', 'rendeConvertAdjacent', {});

    expect(errors).toEqual([]);
    const cat = unit('cat')!;
    expect(cat.owner).toBe('player1');
    expect(cat.direction).toBeLessThan(6);
    expect(() => getShootingPath({ q: cat.q, r: cat.r, s: cat.s }, cat.direction, 5)).not.toThrow();
    expect(() => room.buildValidActions('player1')).not.toThrow();
  });
});

describe('车身朝向在部署时冻结', () => {
  /**
   * 弩车和投石车的 V 形在六边形网格里是**镜像**而不是平移：
   * 玩家1 的投石车是核心 + 上方两格，玩家2 是核心 + 下方两格，
   * 换任何核心都对不齐（±3 范围穷举确认过）。
   * 所以车身一旦跟着 owner 变，招降就会把它原地翻到另一组格子上。
   */
  it.each(['ballista', 'catapult'] as const)('%s：招降换了归属，车身占格不变', (type) => {
    const m = place('m', type, 'player2', 0, 0, { hp: 4, maxHp: 4, deployedBy: 'player2' });
    const before = occupiedHexesOf(m as unknown as UnitLike);

    m.owner = 'player1'; // 招降

    const after = occupiedHexesOf(m as unknown as UnitLike);
    const key = (hs: { q: number; r: number }[]) => hs.map(h => `${h.q},${h.r}`).sort().join('|');
    expect(key(after)).toBe(key(before));
  });

  it('战车是菱形，形状本来就与归属无关', () => {
    const ch = place('ch', 'chariot', 'player2', 0, 0, { hp: 4, maxHp: 4, deployedBy: 'player2' });
    const key = (hs: { q: number; r: number }[]) => hs.map(h => `${h.q},${h.r}`).sort().join('|');
    const before = key(occupiedHexesOf(ch as unknown as UnitLike));
    ch.owner = 'player1';
    expect(key(occupiedHexesOf(ch as unknown as UnitLike))).toBe(before);
  });

  it('deployedBy 为空时回退到当前 owner（测试夹具与老单位）', () => {
    const a = place('a', 'catapult', 'player1', 0, 0, { hp: 4, maxHp: 4 });
    const b = place('b', 'catapult', 'player1', 2, 0, { hp: 4, maxHp: 4, deployedBy: 'player1' });
    const rel = (u: UnitSchema) => occupiedHexesOf(u as unknown as UnitLike)
      .map(h => `${h.q - u.q},${h.r - u.r}`).sort().join('|');
    expect(rel(a)).toBe(rel(b));
  });

  it('部署时写入 deployedBy', () => {
    shenji();
    send('player1', 'shenjiDeployMachine', { machineType: 'catapult', position: { q: -2, r: 4, s: -2 } });
    expect(errors).toEqual([]);
    const cat = Array.from(room.state.units.values()).find(u => u.type === 'catapult')!;
    expect(cat.deployedBy).toBe('player1');
  });

  it('招降后射击朝向仍然翻转（否则捞来的弩车只会朝自己放箭）', () => {
    room.state.player1General = 'rende';
    place('rende', 'general', 'player1', 0, 0, { generalType: 'rende', hp: 4, maxHp: 4 });
    const ball = place('ball', 'ballista', 'player2', 1, 0, {
      hp: 4, maxHp: 4, direction: 7, deployedBy: 'player2',
    });

    send('player1', 'rendeConvertAdjacent', {});

    expect(errors).toEqual([]);
    expect(ball.owner).toBe('player1');
    expect(ball.direction).toBe(6);       // 射击朝向翻了
    expect(ball.deployedBy).toBe('player2'); // 车身没翻
  });
});

describe('仁德改判中立：投石车留下 3 个标记', () => {
  it('按占格数收费，并在每个车身格留标记', () => {
    room.state.player1General = 'rende';
    place('rende', 'general', 'player1', 0, 5, { generalType: 'rende', hp: 4, maxHp: 4 });
    const cat = place('cat', 'catapult', 'player2', 0, 0, { hp: 1, maxHp: 4, direction: Direction.SOUTH_WEST });
    const body = occupiedHexesOf(cat as unknown as UnitLike);
    const before = ap('player1');

    send('player1', 'rendeSpareAsNeutral', { targetId: 'cat' });

    expect(errors).toEqual([]);
    // 原来按普通单位只收 1 点、只留 1 个标记，另两格车身凭空消失
    expect(before - ap('player1')).toBe(3);
    expect(unit('cat')).toBeUndefined();
    const markers = Array.from(room.state.units.values()).filter(u => u.type === 'neutral_marker');
    expect(markers).toHaveLength(3);
    for (const b of body) {
      expect(markers.some(m => m.q === b.q && m.r === b.r), `车身格 (${b.q},${b.r}) 应留下标记`).toBe(true);
    }
  });
});
