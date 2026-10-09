import { describe, expect, it } from 'vitest';
import { diffDamage, type UnitSnapshot } from '../game/damageFeed';
import type { HexCoord } from '../types';

/**
 * 伤害飘字的差分逻辑
 *
 * 伤害反馈走客户端差分而不是服务端事件：服务端 `hp -=` 有 8 处
 * （普通攻击、弩车贯穿、投石车溅射、无双扇形、太平承载…），逐个加广播容易漏，
 * 而差分自动覆盖所有来源。代价是这段逻辑成了唯一的正确性关口，所以锁住它。
 */

const hex = (q: number, r: number): HexCoord => ({ q, r, s: -q - r });
const snap = (hp: number, q = 0, r = 0): UnitSnapshot => ({ hp, position: hex(q, r) });
const map = (o: Record<string, UnitSnapshot>) => new Map(Object.entries(o));

let n = 0;
const keyGen = () => `k${n++}`;

describe('diffDamage', () => {
  it('首帧（prev 为 null）只建立基线，不产生任何飘字', () => {
    const r = diffDamage(null, map({ a: snap(2), b: snap(2) }), keyGen);
    expect(r.flashes).toEqual([]);
    expect(r.hitUnitIds.size).toBe(0);
  });

  it('体力下降 → 一条 damage 飘字，数额是差值', () => {
    const r = diffDamage(map({ a: snap(2) }), map({ a: snap(1) }), keyGen);
    expect(r.flashes).toHaveLength(1);
    expect(r.flashes[0].kind).toBe('damage');
    expect(r.flashes[0].amount).toBe(1);
    expect(r.flashes[0].unitId).toBe('a');
    expect(r.hitUnitIds.has('a')).toBe(true);
  });

  it('一次掉 2 血（骑兵冲锋）也能正确报数', () => {
    const r = diffDamage(map({ a: snap(2) }), map({ a: snap(0) }), keyGen);
    expect(r.flashes[0].amount).toBe(2);
  });

  it('体力不变 → 什么都不报', () => {
    const r = diffDamage(map({ a: snap(2) }), map({ a: snap(2) }), keyGen);
    expect(r.flashes).toEqual([]);
    expect(r.hitUnitIds.size).toBe(0);
  });

  it('体力回升（治疗 / 仁德转化）不报伤害', () => {
    const r = diffDamage(map({ a: snap(1) }), map({ a: snap(2) }), keyGen);
    expect(r.flashes).toEqual([]);
  });

  it('单位消失 → death 飘字，位置取**上一帧**（它已经不在新快照里了）', () => {
    const r = diffDamage(map({ a: snap(1, 3, -2) }), map({}), keyGen);
    expect(r.flashes).toHaveLength(1);
    expect(r.flashes[0].kind).toBe('death');
    expect(r.flashes[0].position).toEqual(hex(3, -2));
    // 死亡不算"受击抖动"——棋子已经没了，没东西可抖
    expect(r.hitUnitIds.size).toBe(0);
  });

  it('掉血后位置也变了（被击退）→ 用新位置画飘字', () => {
    const r = diffDamage(map({ a: snap(2, 0, 0) }), map({ a: snap(1, 1, 0) }), keyGen);
    expect(r.flashes[0].position).toEqual(hex(1, 0));
  });

  it('新出现的单位（部署）不报任何东西', () => {
    const r = diffDamage(map({ a: snap(2) }), map({ a: snap(2), b: snap(2) }), keyGen);
    expect(r.flashes).toEqual([]);
  });

  it('同一帧多个单位受影响（投石车溅射）→ 全部上报', () => {
    const r = diffDamage(
      map({ a: snap(2), b: snap(2), c: snap(1) }),
      map({ a: snap(1), b: snap(1) }),
      keyGen
    );
    expect(r.flashes).toHaveLength(3);
    expect(r.flashes.filter(f => f.kind === 'damage')).toHaveLength(2);
    expect(r.flashes.filter(f => f.kind === 'death')).toHaveLength(1);
    expect(r.hitUnitIds.size).toBe(2); // 死掉的那个不抖
  });

  it('每条飘字的 key 唯一 —— 同一单位连续掉血时不会复用 DOM 节点', () => {
    const a = diffDamage(map({ x: snap(2) }), map({ x: snap(1) }), keyGen);
    const b = diffDamage(map({ x: snap(1) }), map({ x: snap(0) }), keyGen);
    expect(a.flashes[0].key).not.toBe(b.flashes[0].key);
  });
});
