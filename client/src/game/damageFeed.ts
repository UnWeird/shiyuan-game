import { useEffect, useRef, useState } from 'react';
import type { HexCoord, Unit } from '../types';
import { useGameStore } from '../stores/gameStore';

/**
 * 伤害反馈：飘字 + 受击抖动
 *
 * 规格：docs/board-art-spec.md §8.2
 *
 * `@keyframes damage-float` 和 `shake` 在 animations.css 里躺了很久没人用 ——
 * 掉血在界面上**完全没有表现**，玩家只能从战报文字里读到。
 *
 * ## 为什么用客户端 diff 而不是服务端事件
 *
 * 服务端 `hp -=` 有 8 处（普通攻击、弩车贯穿、投石车溅射、无双扇形、
 * 太平承载伤害…），逐个加广播容易漏，而且那条路径正是结算逻辑最密的地方。
 * 这里改成监听 gameStore 的单位快照做差分：
 *
 *   - 自动覆盖**所有**伤害来源，包括以后新加的
 *   - 零服务端改动，不碰结算路径
 *   - 单位被击杀（从 map 里消失）也能捕获，用它最后的位置放一次死亡反馈
 *
 * 代价是拿不到「伤害原因」。但飘字只需要数字和位置，原因在战报里已经有了。
 */

export interface DamageFlash {
  /** 唯一 key，同一单位连续掉血时也不会复用 DOM 节点 */
  key: string;
  unitId: string;
  position: HexCoord;
  /** 掉了多少血；死亡时是它最后的体力 */
  amount: number;
  kind: 'damage' | 'death';
}

/** 飘字停留时间，要和 animations.css 的 .sy-damage-float 时长一致 */
const FLASH_MS = 1000;
/** 抖动时间，要和 .sy-unit-hit 一致 */
const SHAKE_MS = 320;

export interface UnitSnapshot {
  hp: number;
  position: HexCoord;
}

/**
 * 两帧单位快照的差分 —— 纯函数，便于单测。
 *
 * 两个容易写错的点：
 *   1. `prev` 为 null 表示**首帧**，只建立基线。否则刚进对局时全场单位都会被当成"刚掉血"
 *   2. 单位消失（被击杀）时，位置只能取**上一帧**的 —— 它已经不在新快照里了
 */
export function diffDamage(
  prev: ReadonlyMap<string, UnitSnapshot> | null,
  next: ReadonlyMap<string, UnitSnapshot>,
  nextKey: () => string
): { flashes: DamageFlash[]; hitUnitIds: Set<string> } {
  if (prev === null) return { flashes: [], hitUnitIds: new Set() };

  const flashes: DamageFlash[] = [];
  const hitUnitIds = new Set<string>();

  for (const [id, before] of prev) {
    const after = next.get(id);

    if (!after) {
      flashes.push({
        key: nextKey(),
        unitId: id,
        position: before.position,
        amount: before.hp,
        kind: 'death',
      });
      continue;
    }

    if (after.hp < before.hp) {
      flashes.push({
        key: nextKey(),
        unitId: id,
        position: after.position,
        amount: before.hp - after.hp,
        kind: 'damage',
      });
      hitUnitIds.add(id);
    }
  }

  return { flashes, hitUnitIds };
}

/**
 * 返回当前要显示的飘字，以及「哪些单位正在抖」。
 *
 * 只在对局界面挂一次。内部用 ref 存上一帧快照，不进 React state，
 * 避免「为了比较而重渲染」。
 */
export function useDamageFeed(): {
  flashes: DamageFlash[];
  hitUnitIds: ReadonlySet<string>;
} {
  const units = useGameStore(state => state.units);

  const prev = useRef<Map<string, UnitSnapshot> | null>(null);
  const seq = useRef(0);
  const [flashes, setFlashes] = useState<DamageFlash[]>([]);
  const [hitUnitIds, setHitUnitIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const current = new Map<string, UnitSnapshot>();
    for (const u of Object.values(units) as Unit[]) {
      current.set(u.id, { hp: u.hp, position: u.position });
    }

    const { flashes: fresh, hitUnitIds: hit } =
      diffDamage(prev.current, current, () => `d${seq.current++}`);

    prev.current = current;
    if (fresh.length === 0) return;

    setFlashes(list => [...list, ...fresh]);
    setHitUnitIds(hit);

    const keys = new Set(fresh.map(f => f.key));
    const clearFlash = setTimeout(
      () => setFlashes(list => list.filter(f => !keys.has(f.key))),
      FLASH_MS
    );
    const clearShake = setTimeout(() => setHitUnitIds(new Set()), SHAKE_MS);
    return () => {
      clearTimeout(clearFlash);
      clearTimeout(clearShake);
    };
  }, [units]);

  return { flashes, hitUnitIds };
}
