import { describe, expect, it } from 'vitest';
import {
  MAP_RADIUS,
  checkAttackLegality,
  checkBallistaMeleeLegality,
  getAttackableTargets,
  getValidMoves,
  occupiedHexesOf,
  type UnitLike,
} from '../../../shared/rules/queries';

/**
 * 从客户端侧验证 shared/rules/queries.ts 可用
 *
 * 这个文件的意义不在于重复测规则（server 那 43 个测试已经覆盖了），
 * 而在于证明规则查询层真的「共享」：
 *
 * - 不需要 Colyseus，不需要实例化 Room，纯函数直接调
 * - 客户端能 import 并得到和服务端一致的答案
 *
 * 之前客户端是自己又实现了一份（useGameActions.ts，2024 行，已删除）。
 */

const mk = (over: Partial<UnitLike> & Pick<UnitLike, 'id' | 'type' | 'owner' | 'q' | 'r'>): UnitLike => ({
  s: -over.q - over.r,
  direction: 0,
  actionsThisTurn: 0,
  hasMoved: false,
  hasAttacked: false,
  hasActedThisTurn: false,
  generalType: '',
  bonusActionLimit: 0,
  unlimitedActions: false,
  movementRestricted: false,
  movementRestrictionSourceQ: 0,
  movementRestrictionSourceR: 0,
  movementRestrictionSourceS: 0,
  ...over,
});

describe('客户端可直接使用 shared/rules（无需 Colyseus）', () => {
  it('地图半径常量一致', () => {
    expect(MAP_RADIUS).toBe(5);
  });

  it('getValidMoves 可直接调用', () => {
    const u = mk({ id: 'a', type: 'infantry', owner: 'player1', q: 0, r: 0 });
    const moves = getValidMoves(u, [u]);
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) expect(m.q + m.r + m.s).toBe(0);
  });

  it('checkAttackLegality 可直接调用', () => {
    const a = mk({ id: 'a', type: 'infantry', owner: 'player1', q: 0, r: 0 });
    const near = mk({ id: 'n', type: 'infantry', owner: 'player2', q: 1, r: 0 });
    const far = mk({ id: 'f', type: 'infantry', owner: 'player2', q: 3, r: 0 });
    expect(checkAttackLegality(a, near, [a, near, far]).ok).toBe(true);
    expect(checkAttackLegality(a, far, [a, near, far]).ok).toBe(false);
  });

  it('getAttackableTargets 可直接调用', () => {
    const a = mk({ id: 'a', type: 'infantry', owner: 'player1', q: 0, r: 0 });
    const foe = mk({ id: 'foe', type: 'infantry', owner: 'player2', q: 1, r: 0 });
    const friend = mk({ id: 'fr', type: 'infantry', owner: 'player1', q: -1, r: 0 });
    expect(getAttackableTargets(a, [a, foe, friend])).toEqual(['foe']);
  });

  it('机关体积与弩车近战判定可直接调用', () => {
    const bal = mk({ id: 'b', type: 'ballista', owner: 'player1', q: 0, r: 2 });
    expect(occupiedHexesOf(bal)).toHaveLength(3);

    const near = mk({ id: 'n', type: 'infantry', owner: 'player2', q: 1, r: 2 });
    const far = mk({ id: 'f', type: 'infantry', owner: 'player2', q: 0, r: -4 });
    const all = [bal, near, far];
    expect(checkBallistaMeleeLegality(bal, near, all).ok).toBe(true);
    expect(checkBallistaMeleeLegality(bal, far, all).ok).toBe(false);
  });

  it('无双的 unlimitedActions 规则在共享实现里（客户端旧实现正是漏了这条）', () => {
    const g = mk({
      id: 'g', type: 'general', owner: 'player1', q: 0, r: 0,
      generalType: 'wushuang', hasMoved: true, unlimitedActions: true, actionsThisTurn: 1,
    });
    expect(getValidMoves(g, [g]).length).toBeGreaterThan(0);

    const noFlag = { ...g, unlimitedActions: false };
    expect(getValidMoves(noFlag, [noFlag])).toEqual([]);
  });
});
