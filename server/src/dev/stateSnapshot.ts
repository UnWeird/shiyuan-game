import { GameStateSchema, UnitSchema } from '../schema/GameState';

/**
 * 开发用：对局状态的存档 / 读档
 *
 * 目的是消灭「为了验一个中局 bug，开两个浏览器窗口从选将开始打十分钟」。
 * 存下来的快照是服务端权威状态的完整镜像，可以存成文件当作 bug 复现用例。
 *
 * 安全：所有入口都由 ShiyuanRoom 里的 DEV_TOOLS 开关（环境变量
 * SHIYUAN_DEV_TOOLS=1）守卫，默认关闭。开着的话任何客户端都能改写对局状态，
 * 绝不能在正式服打开。
 */

/** 需要特殊处理的集合字段，其余字段都是基本类型，直接赋值 */
const ARRAY_FIELDS = [
  'player1DiceResults',
  'player2DiceResults',
  'battleLog',
  'wushuangDiceRolls',
] as const;

export interface StateSnapshot {
  /** 快照格式版本，schema 大改后可据此拒绝旧档 */
  __version: number;
  /** 便于人眼辨认的说明 */
  __label?: string;
  __savedAt?: string;
  [key: string]: unknown;
}

export const SNAPSHOT_VERSION = 1;

/**
 * 导出当前状态为纯 JSON。
 * 直接用 Colyseus 的 toJSON()，保证和线上同步的字段完全一致。
 */
export function captureState(state: GameStateSchema, label?: string): StateSnapshot {
  const raw = state.toJSON() as Record<string, unknown>;
  return {
    __version: SNAPSHOT_VERSION,
    __label: label,
    __savedAt: new Date().toISOString(),
    ...raw,
  };
}

export interface RestoreResult {
  ok: boolean
  /** 失败原因，或成功时的简要说明 */
  message: string
  /** 快照里存在但当前 schema 没有的字段（schema 改过的信号） */
  unknownFields: string[]
  unitCount: number
}

/**
 * 把快照写回 state。
 * 基本类型逐个赋值，集合字段先 clear 再重建，units 重新构造 UnitSchema 实例。
 */
export function restoreState(state: GameStateSchema, snapshot: StateSnapshot): RestoreResult {
  if (!snapshot || typeof snapshot !== 'object') {
    return { ok: false, message: '快照不是一个对象', unknownFields: [], unitCount: 0 };
  }
  if (snapshot.__version !== SNAPSHOT_VERSION) {
    return {
      ok: false,
      message: `快照版本不匹配（存档 ${snapshot.__version}，当前 ${SNAPSHOT_VERSION}）`,
      unknownFields: [],
      unitCount: 0,
    };
  }

  const anyState = state as unknown as Record<string, unknown>;
  const unknownFields: string[] = [];

  for (const [key, value] of Object.entries(snapshot)) {
    // 跳过元数据与需要单独处理的字段
    if (key.startsWith('__') || key === 'units') continue;

    if ((ARRAY_FIELDS as readonly string[]).includes(key)) {
      const arr = anyState[key] as { clear: () => void; push: (v: unknown) => number };
      if (!arr) { unknownFields.push(key); continue; }
      arr.clear();
      if (Array.isArray(value)) value.forEach(v => arr.push(v));
      continue;
    }

    if (!(key in anyState)) {
      unknownFields.push(key);
      continue;
    }
    anyState[key] = value;
  }

  // 重建单位：必须是真正的 UnitSchema 实例，普通对象不会被同步
  state.units.clear();
  const units = (snapshot.units ?? {}) as Record<string, Record<string, unknown>>;
  let unitCount = 0;
  for (const [id, plain] of Object.entries(units)) {
    const unit = new UnitSchema();
    const anyUnit = unit as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(plain)) {
      if (k in anyUnit) anyUnit[k] = v;
    }
    state.units.set(id, unit);
    unitCount++;
  }

  return {
    ok: true,
    message: `已载入局面（${unitCount} 个单位，回合 ${String(anyState.turn)}，阶段 ${String(anyState.phase)}）`,
    unknownFields,
    unitCount,
  };
}
