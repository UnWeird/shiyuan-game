import { create } from 'zustand';
import type { HexCoord } from '../types';

/**
 * 「指令已发出、等服务端确认」的中间状态
 *
 * 在线模式下点一下棋子并不会立刻生效：指令要走一个 RTT。
 * 原来的做法是点完立刻取消选中、清高亮、并往战报里写「移动了」，
 * 棋子却要等服务端回包才动 —— 看起来像没反应，被拒绝时战报还已经撒过谎。
 *
 * 这里不在本地重演规则（那会把服务端 4000 行规则再抄一遍），
 * 只记录「我请求了什么」，界面上用半透明幽灵棋子表示「在路上」，
 * 等服务端状态到了再落定或回滚。
 */

export interface PendingAction {
  kind: 'move' | 'attack';
  /** 发起动作的单位 */
  unitId: string;
  /** 期望落点（移动），或被攻击者所在格（攻击） */
  target: HexCoord;
  targetUnitId?: string;
  /** 发出指令时该单位的位置，用来判断服务端是否已生效 */
  fromPosition: HexCoord;
  /** 发出指令时的行动次数，位置不变的动作（如攻击）靠它判断生效 */
  actionsBefore: number;
  /** 发出指令时目标的血量 */
  targetHpBefore?: number;
  sentAt: number;
}

/** 超时兜底：服务端既不确认也不报错时，别让幽灵一直挂着 */
const TIMEOUT_MS = 2500;

interface PendingState {
  pending: PendingAction | null;
  /** 被拒绝的单位 id，用于播放一次抖动；短暂存在 */
  rejectedUnitId: string | null;

  begin: (action: Omit<PendingAction, 'sentAt'>) => void;
  /** 服务端已确认，落定 */
  settle: () => void;
  /** 服务端拒绝或超时，回滚 */
  reject: () => void;
  clearRejected: () => void;
}

let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
let rejectTimer: ReturnType<typeof setTimeout> | null = null;

const clearTimer = () => {
  if (timeoutTimer) clearTimeout(timeoutTimer);
  timeoutTimer = null;
};

export const usePendingStore = create<PendingState>((set, get) => ({
  pending: null,
  rejectedUnitId: null,

  begin: (action) => {
    clearTimer();
    set({ pending: { ...action, sentAt: Date.now() } });
    timeoutTimer = setTimeout(() => {
      // 超时当作失败处理，但不弹错误：可能只是网络慢
      if (get().pending) get().reject();
    }, TIMEOUT_MS);
  },

  settle: () => {
    clearTimer();
    set({ pending: null });
  },

  reject: () => {
    clearTimer();
    const unitId = get().pending?.unitId ?? null;
    set({ pending: null, rejectedUnitId: unitId });
    if (rejectTimer) clearTimeout(rejectTimer);
    // 抖动动画约 400ms，之后清掉标记
    rejectTimer = setTimeout(() => set({ rejectedUnitId: null }), 450);
  },

  clearRejected: () => set({ rejectedUnitId: null }),
}));

/**
 * 判定需要用到的最小单位形状。
 * 刻意不依赖客户端完整的 Unit 接口，这样 ColyseusService 里
 * 还没转换完的原始对象也能直接传进来。
 */
interface ActorLike {
  position: HexCoord;
  actionsThisTurn: number;
  hp: number;
}

/**
 * 拿服务端同步下来的单位表，判断待确认的动作是否已经生效。
 *
 * 判定条件放得比较宽：只要发起单位或目标单位有任何相关变化就算生效。
 * 宁可早一点落定（幽灵消失、真棋子就位），也不要卡着不动。
 */
export function reconcilePending(units: Record<string, ActorLike>): void {
  const { pending, settle } = usePendingStore.getState();
  if (!pending) return;

  const actor = units[pending.unitId];

  // 发起单位没了（被反击打死等）—— 动作已经结算
  if (!actor) {
    settle();
    return;
  }

  // 位置变了 —— 移动生效
  const moved =
    actor.position.q !== pending.fromPosition.q ||
    actor.position.r !== pending.fromPosition.r ||
    actor.position.s !== pending.fromPosition.s;
  if (moved) {
    settle();
    return;
  }

  // 行动次数变了 —— 原地动作（攻击、转向）生效
  if (actor.actionsThisTurn !== pending.actionsBefore) {
    settle();
    return;
  }

  // 目标单位消失或掉血 —— 攻击生效
  if (pending.targetUnitId) {
    const victim = units[pending.targetUnitId];
    if (!victim) {
      settle();
      return;
    }
    if (pending.targetHpBefore !== undefined && victim.hp !== pending.targetHpBefore) {
      settle();
      return;
    }
  }
}

/** 供 React 之外的代码使用（ColyseusService 是单例） */
export const pendingAction = {
  begin: (a: Omit<PendingAction, 'sentAt'>) => usePendingStore.getState().begin(a),
  settle: () => usePendingStore.getState().settle(),
  reject: () => usePendingStore.getState().reject(),
};
