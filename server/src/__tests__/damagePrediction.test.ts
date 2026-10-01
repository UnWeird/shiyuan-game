import { describe, expect, it } from 'vitest';
import type { UnitLike } from '../../../shared/rules/queries';
import {
  adjacentFriendlyInfantryCount,
  findRearInfantrySupport,
  isDepthDefended,
  isLethal,
  predictDamage,
} from '../../../shared/rules/queries';

/**
 * 伤害预测的单元测试
 *
 * 这几个函数是从 ShiyuanRoom.handleAttack 里抽出来的纯查询，
 * 现在是**唯一一份**伤害计算：
 *   - handleAttack 用它落伤害
 *   - buildValidActions 用它判断「这一下能不能杀」，客户端据此把矛尖画成实心
 *
 * 所以它必须被锁住：一旦两边的理解分叉，玩家会看到「实心矛尖」却没杀掉人。
 *
 * 规则（出自 handleAttack）：
 *   基础伤害 1
 *   骑兵本回合移动满 2 格 → +1，但目标相邻己方步兵 ≥2 时该加成被抵消
 *   弓箭手打步兵、且步兵背离方向有连续己方步兵 → 纵深抗击，伤害 0
 */

function u(o: Partial<UnitLike> & { id: string; type: string; owner: string; q: number; r: number }): UnitLike {
  return {
    direction: 0, hp: 2, moveDistance: 0, actionsThisTurn: 0,
    hasMoved: false, hasAttacked: false, hasActedThisTurn: false,
    generalType: '', bonusActionLimit: 0, unlimitedActions: false,
    movementRestricted: false,
    movementRestrictionSourceQ: 0, movementRestrictionSourceR: 0, movementRestrictionSourceS: 0,
    ...o,
    s: -o.q - o.r,
  } as UnitLike;
}

describe('predictDamage —— 基础', () => {
  it('普通攻击造成 1 点', () => {
    const a = u({ id: 'a', type: 'infantry', owner: 'player1', q: 0, r: 0 });
    const t = u({ id: 't', type: 'infantry', owner: 'player2', q: 1, r: 0 });
    expect(predictDamage(a, t, [a, t])).toBe(1);
  });

  it('骑兵没冲锋（moveDistance 0）时不加成', () => {
    const a = u({ id: 'a', type: 'cavalry', owner: 'player1', q: 0, r: 0, moveDistance: 0 });
    const t = u({ id: 't', type: 'infantry', owner: 'player2', q: 1, r: 0 });
    expect(predictDamage(a, t, [a, t])).toBe(1);
  });

  it('骑兵移动 3 格也不加成 —— 加成只在恰好 2 格时触发', () => {
    const a = u({ id: 'a', type: 'cavalry', owner: 'player1', q: 0, r: 0, moveDistance: 3 });
    const t = u({ id: 't', type: 'infantry', owner: 'player2', q: 1, r: 0 });
    expect(predictDamage(a, t, [a, t])).toBe(1);
  });

  it('只有骑兵有冲锋加成，战车没有（服务端不给战车记 moveDistance）', () => {
    const a = u({ id: 'a', type: 'chariot', owner: 'player1', q: 0, r: 0, moveDistance: 2 });
    const t = u({ id: 't', type: 'infantry', owner: 'player2', q: 1, r: 0 });
    expect(predictDamage(a, t, [a, t])).toBe(1);
  });
});

describe('predictDamage —— 骑兵冲锋与步兵护卫', () => {
  it('骑兵冲 2 格：伤害 +1', () => {
    const a = u({ id: 'a', type: 'cavalry', owner: 'player1', q: 0, r: 0, moveDistance: 2 });
    const t = u({ id: 't', type: 'infantry', owner: 'player2', q: 1, r: 0 });
    expect(predictDamage(a, t, [a, t])).toBe(2);
  });

  it('目标相邻己方步兵 1 个：加成仍然生效', () => {
    const a = u({ id: 'a', type: 'cavalry', owner: 'player1', q: 0, r: 0, moveDistance: 2 });
    const t = u({ id: 't', type: 'infantry', owner: 'player2', q: 2, r: 0 });
    const g1 = u({ id: 'g1', type: 'infantry', owner: 'player2', q: 3, r: 0 });
    expect(adjacentFriendlyInfantryCount(t, [a, t, g1])).toBe(1);
    expect(predictDamage(a, t, [a, t, g1])).toBe(2);
  });

  it('目标相邻己方步兵 2 个：护卫生效，加成被抵消', () => {
    const a = u({ id: 'a', type: 'cavalry', owner: 'player1', q: 0, r: 0, moveDistance: 2 });
    const t = u({ id: 't', type: 'infantry', owner: 'player2', q: 2, r: 0 });
    const g1 = u({ id: 'g1', type: 'infantry', owner: 'player2', q: 3, r: 0 });
    const g2 = u({ id: 'g2', type: 'infantry', owner: 'player2', q: 2, r: 1 });
    expect(adjacentFriendlyInfantryCount(t, [a, t, g1, g2])).toBe(2);
    expect(predictDamage(a, t, [a, t, g1, g2])).toBe(1);
  });

  it('相邻的是敌方步兵，不算护卫', () => {
    const a = u({ id: 'a', type: 'cavalry', owner: 'player1', q: 0, r: 0, moveDistance: 2 });
    const t = u({ id: 't', type: 'infantry', owner: 'player2', q: 2, r: 0 });
    const e1 = u({ id: 'e1', type: 'infantry', owner: 'player1', q: 3, r: 0 });
    const e2 = u({ id: 'e2', type: 'infantry', owner: 'player1', q: 2, r: 1 });
    expect(adjacentFriendlyInfantryCount(t, [a, t, e1, e2])).toBe(0);
    expect(predictDamage(a, t, [a, t, e1, e2])).toBe(2);
  });

  it('相邻的是己方骑兵而非步兵，不算护卫', () => {
    const a = u({ id: 'a', type: 'cavalry', owner: 'player1', q: 0, r: 0, moveDistance: 2 });
    const t = u({ id: 't', type: 'infantry', owner: 'player2', q: 2, r: 0 });
    const c1 = u({ id: 'c1', type: 'cavalry', owner: 'player2', q: 3, r: 0 });
    const c2 = u({ id: 'c2', type: 'cavalry', owner: 'player2', q: 2, r: 1 });
    expect(adjacentFriendlyInfantryCount(t, [a, t, c1, c2])).toBe(0);
    expect(predictDamage(a, t, [a, t, c1, c2])).toBe(2);
  });
});

describe('纵深抗击', () => {
  /** 弓手在 (0,0) 朝 +q 方向打 (1,0) 的步兵；背离方向就是 q 继续增大 */
  const archer = () => u({ id: 'arc', type: 'archer', owner: 'player1', q: 0, r: 0 });
  const front = () => u({ id: 'f', type: 'infantry', owner: 'player2', q: 1, r: 0 });

  it('背后紧贴一个己方步兵：触发，伤害 0', () => {
    const a = archer(), f = front();
    const rear = u({ id: 'r1', type: 'infantry', owner: 'player2', q: 2, r: 0 });
    const units = [a, f, rear];
    expect(isDepthDefended(a, f, units)).toBe(true);
    expect(predictDamage(a, f, units)).toBe(0);
  });

  it('背后是空的：不触发', () => {
    const a = archer(), f = front();
    expect(isDepthDefended(a, f, [a, f])).toBe(false);
    expect(predictDamage(a, f, [a, f])).toBe(1);
  });

  it('背后有缺口（隔一格才有步兵）：不连续，不触发', () => {
    const a = archer(), f = front();
    const far = u({ id: 'r2', type: 'infantry', owner: 'player2', q: 3, r: 0 });
    const units = [a, f, far];
    expect(findRearInfantrySupport(a, f, units)).toHaveLength(0);
    expect(predictDamage(a, f, units)).toBe(1);
  });

  it('背后连续两个：支援队列长度 2，按距攻击者的距离升序', () => {
    const a = archer(), f = front();
    const r1 = u({ id: 'r1', type: 'infantry', owner: 'player2', q: 2, r: 0 });
    const r2 = u({ id: 'r2', type: 'infantry', owner: 'player2', q: 3, r: 0 });
    const support = findRearInfantrySupport(a, f, [a, f, r1, r2]);
    expect(support.map(x => x.unit.id)).toEqual(['r1', 'r2']);
    expect(support.map(x => x.distance)).toEqual([2, 3]);
  });

  it('背后是敌方步兵：不算支援', () => {
    const a = archer(), f = front();
    const foe = u({ id: 'x', type: 'infantry', owner: 'player1', q: 2, r: 0 });
    expect(isDepthDefended(a, f, [a, f, foe])).toBe(false);
  });

  it('只对「弓箭手打步兵」生效：步兵打步兵不触发', () => {
    const a = u({ id: 'a', type: 'infantry', owner: 'player1', q: 0, r: 0 });
    const f = front();
    const rear = u({ id: 'r1', type: 'infantry', owner: 'player2', q: 2, r: 0 });
    expect(isDepthDefended(a, f, [a, f, rear])).toBe(false);
    expect(predictDamage(a, f, [a, f, rear])).toBe(1);
  });

  it('只对「弓箭手打步兵」生效：弓箭手打骑兵不触发', () => {
    const a = archer();
    const t = u({ id: 't', type: 'cavalry', owner: 'player2', q: 1, r: 0 });
    const rear = u({ id: 'r1', type: 'infantry', owner: 'player2', q: 2, r: 0 });
    expect(isDepthDefended(a, t, [a, t, rear])).toBe(false);
  });
});

describe('isLethal —— 客户端画实心矛尖的依据', () => {
  it('满血 2 的步兵被打 1 点：不致命', () => {
    const a = u({ id: 'a', type: 'infantry', owner: 'player1', q: 0, r: 0 });
    const t = u({ id: 't', type: 'infantry', owner: 'player2', q: 1, r: 0, hp: 2 });
    expect(isLethal(a, t, [a, t])).toBe(false);
  });

  it('剩 1 血被打 1 点：致命', () => {
    const a = u({ id: 'a', type: 'infantry', owner: 'player1', q: 0, r: 0 });
    const t = u({ id: 't', type: 'infantry', owner: 'player2', q: 1, r: 0, hp: 1 });
    expect(isLethal(a, t, [a, t])).toBe(true);
  });

  it('满血 2 被冲锋骑兵打 2 点：致命', () => {
    const a = u({ id: 'a', type: 'cavalry', owner: 'player1', q: 0, r: 0, moveDistance: 2 });
    const t = u({ id: 't', type: 'infantry', owner: 'player2', q: 1, r: 0, hp: 2 });
    expect(isLethal(a, t, [a, t])).toBe(true);
  });

  it('同上但目标有 2 个步兵护卫：加成被抵消，不致命', () => {
    const a = u({ id: 'a', type: 'cavalry', owner: 'player1', q: 0, r: 0, moveDistance: 2 });
    const t = u({ id: 't', type: 'infantry', owner: 'player2', q: 2, r: 0, hp: 2 });
    const g1 = u({ id: 'g1', type: 'infantry', owner: 'player2', q: 3, r: 0 });
    const g2 = u({ id: 'g2', type: 'infantry', owner: 'player2', q: 2, r: 1 });
    expect(isLethal(a, t, [a, t, g1, g2])).toBe(false);
  });

  it('触发纵深抗击时伤害 0：即使目标剩 1 血也不致命', () => {
    const a = u({ id: 'arc', type: 'archer', owner: 'player1', q: 0, r: 0 });
    const t = u({ id: 't', type: 'infantry', owner: 'player2', q: 1, r: 0, hp: 1 });
    const rear = u({ id: 'r1', type: 'infantry', owner: 'player2', q: 2, r: 0 });
    expect(predictDamage(a, t, [a, t, rear])).toBe(0);
    expect(isLethal(a, t, [a, t, rear])).toBe(false);
  });
});
