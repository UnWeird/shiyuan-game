import { create } from 'zustand';
import type { HexCoord } from '../types';
import { MOVE_FLAG_DAMAGE_UP, MOVE_FLAG_NO_ATTACK } from '../../../shared/rules/queries';

/**
 * 服务端下发的「当前行动方每个单位能做什么」
 *
 * 为什么要这个：以前客户端自己实现了一份 getValidMoves / getValidAttacks 来算高亮，
 * 服务端另有一份用于校验。两份实现会漂移，结果是界面高亮了一个格子、
 * 玩家点下去被服务端拒绝 —— 也就是「没法一遍过」。
 *
 * 现在高亮和校验共用服务端那一份判断，不可能不一致。
 *
 * 不塞进 gameStore：那个文件已经 870 行，而且这是纯展示用的派生数据，
 * 不属于对局状态本身。与 pendingAction.ts 同级。
 */

/**
 * 服务端消息格式：移动格子编码为 [q, r, steps, flags]，s 由 -q-r 推出。
 *
 * flags 是位掩码（见 shared/rules/queries.ts 的 MOVE_FLAG_*），告诉客户端
 * 「落在这一格会有什么后果」。**不要在客户端按 steps 自己推** ——
 * 「移动 2 格伤害 +1」是服务端的规则数值，推一遍就多一份会漂移的实现。
 * 旧版服务端只发三元组，所以 flags 可能是 undefined。
 */
export interface ValidActionsPayload {
  forPlayer: 'player1' | 'player2';
  phase: string;
  moves: Record<string, Array<[number, number, number, number?]>>;
  attacks: Record<string, string[]>;
  /**
   * 机关的「范围型」攻击覆盖格（弩车垂直贯穿、投石车沿朝向射击）。
   * 这类攻击不是选一个目标，而是覆盖一条线，所以和 attacks 分开表达。
   */
  attackHexes: Record<string, Array<[number, number]>>;
}

/** 解码后的移动格子，形状与客户端既有的高亮数据一致 */
export type MoveHex = HexCoord & {
  steps?: number;
  /** 伤害 +1（骑兵冲 2 格）。注意是"有机会 +1"：目标相邻己方步兵 ≥2 时会被抵消 */
  damageUp?: boolean;
  /** 本回合不能攻击（骑兵冲满 3 格） */
  noAttack?: boolean;
};

interface ValidActionsState {
  /** 这份数据是算给哪一方的；不是自己这方时不该用来画自己的高亮 */
  forPlayer: 'player1' | 'player2' | null;
  /** unitId -> 合法落点 */
  moves: Record<string, MoveHex[]>;
  /** unitId -> 可攻击目标 unitId */
  attacks: Record<string, string[]>;
  /** unitId -> 范围型攻击覆盖格 */
  attackHexes: Record<string, HexCoord[]>;

  apply: (payload: ValidActionsPayload) => void;
  clear: () => void;
}

export const useValidActionsStore = create<ValidActionsState>((set) => ({
  forPlayer: null,
  moves: {},
  attacks: {},
  attackHexes: {},

  apply: (payload) => {
    const moves: Record<string, MoveHex[]> = {};
    for (const [unitId, list] of Object.entries(payload.moves ?? {})) {
      moves[unitId] = list.map(([q, r, steps, flags]) => ({
        q, r, s: -q - r, steps,
        damageUp: ((flags ?? 0) & MOVE_FLAG_DAMAGE_UP) !== 0,
        noAttack: ((flags ?? 0) & MOVE_FLAG_NO_ATTACK) !== 0,
      }));
    }
    const attackHexes: Record<string, HexCoord[]> = {};
    for (const [unitId, list] of Object.entries(payload.attackHexes ?? {})) {
      attackHexes[unitId] = list.map(([q, r]) => ({ q, r, s: -q - r }));
    }
    set({ forPlayer: payload.forPlayer, moves, attacks: payload.attacks ?? {}, attackHexes });
  },

  clear: () => set({ forPlayer: null, moves: {}, attacks: {}, attackHexes: {} }),
}));

/** 供 React 之外使用（ColyseusService 是单例） */
export const validActions = {
  apply: (p: ValidActionsPayload) => useValidActionsStore.getState().apply(p),
  clear: () => useValidActionsStore.getState().clear(),
};

/** 读取某个单位的合法落点；没有数据时返回空数组 */
export function getServerMoves(unitId: string): MoveHex[] {
  return useValidActionsStore.getState().moves[unitId] ?? [];
}

/** 读取某个单位可攻击的目标 id */
export function getServerAttackTargets(unitId: string): string[] {
  return useValidActionsStore.getState().attacks[unitId] ?? [];
}

/** 读取某个单位的范围型攻击覆盖格（弩车贯穿线、投石车射击线） */
export function getServerAttackHexes(unitId: string): HexCoord[] {
  return useValidActionsStore.getState().attackHexes[unitId] ?? [];
}
