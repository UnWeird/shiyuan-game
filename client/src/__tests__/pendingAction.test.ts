import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcilePending, usePendingStore } from '../game/pendingAction';
import { createHex } from '../../../shared/utils/hexUtils';
import type { HexCoord } from '../../../shared/types';

/**
 * 「指令待服务端确认」的落定判定
 *
 * 这块逻辑决定了幽灵棋子什么时候消失。判错的后果很直接：
 * 判早了会闪现两个棋子，判晚了幽灵挂着不走、看着像卡死。
 */

const H = (q: number, r: number) => createHex(q, r);

/** 构造判定需要的最小单位形状 */
const actor = (position: HexCoord, actionsThisTurn = 0, hp = 1) => ({
  position,
  actionsThisTurn,
  hp,
});

/** 登记一个移动指令：单位 u1 从 (0,0) 走到 (1,0) */
function beginMove() {
  usePendingStore.getState().begin({
    kind: 'move',
    unitId: 'u1',
    target: H(1, 0),
    fromPosition: H(0, 0),
    actionsBefore: 0,
  });
}

/** 登记一个攻击指令：u1 打 (1,0) 上的 v1（血量 2） */
function beginAttack() {
  usePendingStore.getState().begin({
    kind: 'attack',
    unitId: 'u1',
    target: H(1, 0),
    targetUnitId: 'v1',
    fromPosition: H(0, 0),
    actionsBefore: 0,
    targetHpBefore: 2,
  });
}

describe('reconcilePending', () => {
  beforeEach(() => {
    // 每个用例从干净状态开始，并清掉可能残留的定时器
    usePendingStore.setState({ pending: null, rejectedUnitId: null });
    vi.useRealTimers();
  });

  it('没有待确认指令时什么都不做', () => {
    expect(() => reconcilePending({})).not.toThrow();
    expect(usePendingStore.getState().pending).toBeNull();
  });

  it('状态没变化时保持待确认（幽灵继续显示）', () => {
    beginMove();
    reconcilePending({ u1: actor(H(0, 0), 0) });
    expect(usePendingStore.getState().pending).not.toBeNull();
  });

  it('位置变了 -> 落定', () => {
    beginMove();
    reconcilePending({ u1: actor(H(1, 0), 1) });
    expect(usePendingStore.getState().pending).toBeNull();
  });

  it('位置变成了别处（被服务端改判）也落定，不会卡住', () => {
    beginMove();
    // 服务端把它放到了另一个格子
    reconcilePending({ u1: actor(H(0, 1), 1) });
    expect(usePendingStore.getState().pending).toBeNull();
  });

  // 下面三条分别只动一个轴、且行动次数保持不变，
  // 这样落定只能由位置比较触发。否则「位置比较漏了 r/s」这种 bug
  // 会被行动次数判定顺手盖住，测试看着过了其实没测到。
  it.each([
    ['q 轴', H(1, 0)],
    ['r 轴', H(0, 1)],
    ['s 轴', H(1, -1)],
  ])('只有位置沿 %s 变化（行动次数不变）也能落定', (_axis, moved) => {
    usePendingStore.setState({ pending: null, rejectedUnitId: null });
    usePendingStore.getState().begin({
      kind: 'move',
      unitId: 'u1',
      target: moved,
      fromPosition: H(0, 0),
      actionsBefore: 3,
    });
    reconcilePending({ u1: actor(moved, 3) }); // 行动次数刻意保持 3
    expect(usePendingStore.getState().pending).toBeNull();
  });

  it('发起单位消失（被反击打死）-> 落定', () => {
    beginMove();
    reconcilePending({});
    expect(usePendingStore.getState().pending).toBeNull();
  });

  it('攻击：原地不动但行动次数增加 -> 落定', () => {
    beginAttack();
    reconcilePending({
      u1: actor(H(0, 0), 1), // 位置没变，但行动次数 0 -> 1
      v1: actor(H(1, 0), 0, 2),
    });
    expect(usePendingStore.getState().pending).toBeNull();
  });

  it('攻击：目标掉血 -> 落定', () => {
    beginAttack();
    reconcilePending({
      u1: actor(H(0, 0), 0),
      v1: actor(H(1, 0), 0, 1), // 2 -> 1
    });
    expect(usePendingStore.getState().pending).toBeNull();
  });

  it('攻击：目标被打死消失 -> 落定', () => {
    beginAttack();
    reconcilePending({ u1: actor(H(0, 0), 0) }); // v1 不在了
    expect(usePendingStore.getState().pending).toBeNull();
  });

  it('攻击：目标毫发无损且行动次数未变 -> 仍在等待', () => {
    beginAttack();
    reconcilePending({
      u1: actor(H(0, 0), 0),
      v1: actor(H(1, 0), 0, 2),
    });
    expect(usePendingStore.getState().pending).not.toBeNull();
  });
});

describe('拒绝与超时', () => {
  beforeEach(() => {
    usePendingStore.setState({ pending: null, rejectedUnitId: null });
  });

  it('reject 清掉待确认并标记该单位需要抖动', () => {
    vi.useRealTimers();
    beginMove();
    usePendingStore.getState().reject();
    const s = usePendingStore.getState();
    expect(s.pending).toBeNull();
    expect(s.rejectedUnitId).toBe('u1');
  });

  it('抖动标记会在动画结束后自动清除', () => {
    vi.useFakeTimers();
    beginMove();
    usePendingStore.getState().reject();
    expect(usePendingStore.getState().rejectedUnitId).toBe('u1');
    vi.advanceTimersByTime(500);
    expect(usePendingStore.getState().rejectedUnitId).toBeNull();
    vi.useRealTimers();
  });

  it('服务端既不确认也不报错时，超时自动回滚，幽灵不会永久挂着', () => {
    vi.useFakeTimers();
    beginMove();
    expect(usePendingStore.getState().pending).not.toBeNull();
    vi.advanceTimersByTime(2600); // 超过 2500ms 超时
    expect(usePendingStore.getState().pending).toBeNull();
    vi.useRealTimers();
  });

  it('已落定的指令不会再被超时误伤', () => {
    vi.useFakeTimers();
    beginMove();
    reconcilePending({ u1: actor(H(1, 0), 1) }); // 提前落定
    expect(usePendingStore.getState().pending).toBeNull();
    vi.advanceTimersByTime(3000);
    // 超时回调里有 pending 判空，不该把 rejectedUnitId 点亮
    expect(usePendingStore.getState().rejectedUnitId).toBeNull();
    vi.useRealTimers();
  });

  it('连续发两条指令时，后一条覆盖前一条且旧定时器不会误触发', () => {
    vi.useFakeTimers();
    beginMove();
    vi.advanceTimersByTime(2000); // 快到超时
    beginAttack();                // 新指令重置计时
    vi.advanceTimersByTime(1000); // 累计 3000，但新指令才过 1000
    expect(usePendingStore.getState().pending).not.toBeNull();
    expect(usePendingStore.getState().pending!.kind).toBe('attack');
    vi.useRealTimers();
  });
});
