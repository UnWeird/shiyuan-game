import { Unit, HexCoord, UnitType, Direction, Player } from '../types';
import { useGameStore } from '../stores/gameStore';
import {
  hexNeighbors,
  hexNeighbor,
  hexEquals,
  hexDistance,
  hexRange,
  isInStartZone,
  getShootingPath,
  getBallistaVerticalPath,
  getMachineOccupiedHexes,
  isInMapRange,
  getAxisLineFromTarget,
  getDistanceToBaseline,
  getFanShapedHexes,
} from '../utils/hexUtils';

export const useGameActions = () => {
  const {
    units,
    currentPlayer,
    selectedUnitId,
    player1ActionPoints,
    player2ActionPoints,
    player1Base,
    player2Base,
    updateUnit,
    removeUnit,
    addUnit,
    consumeActionPoint,
    recordKill,
    setPhase,
  } = useGameStore();

  const currentActionPoints = currentPlayer === Player.PLAYER1 ? player1ActionPoints : player2ActionPoints;
  const selectedUnit = selectedUnitId ? units[selectedUnitId] : null;

  // 辅助函数：处理战车崩毁，生成2个步兵
  const handleChariotDeath = (chariot: Unit, canAct: boolean = false) => {
    const chariotPos = chariot.position;

    // 战车崩毁奖励：如果碾死过人，神机将军的拥有者获得1次重投机会
    if ('killCount' in chariot && (chariot as any).killCount > 0) {
      useGameStore.getState().addRerollToken(chariot.owner);
    }

    // 生成第一个步兵（在原位置）
    const infantry1: Unit = {
      id: `unit-${Date.now()}-${Math.random()}`,
      type: UnitType.INFANTRY,
      owner: chariot.owner,
      position: chariotPos,
      hp: 2,
      maxHp: 2,
      direction: chariot.direction,
      actionsThisTurn: canAct ? 0 : 2,
      hasMoved: !canAct,
      hasAttacked: !canAct,
    };

    addUnit(infantry1);

    // 第二个步兵：寻找相邻空位
    const neighbors = hexNeighbors(chariotPos);
    const emptyPos = neighbors.find(pos => {
      // 检查是否有单位占用
      const hasUnit = Object.values(units).some(u => hexEquals(u.position, pos));
      if (hasUnit) return false;

      // 检查是否被机关单位占据
      const occupiedByMachine = Object.values(units).some(u => {
        if (u.type === UnitType.BALLISTA || u.type === UnitType.CHARIOT) {
          const machineType = u.type === UnitType.BALLISTA ? 'ballista' : 'chariot';
          const occupied = getMachineOccupiedHexes(u.position, machineType);
          return occupied.some(hex => hexEquals(hex, pos));
        }
        return false;
      });

      return !occupiedByMachine && isInMapRange(pos, 5);
    });

    if (emptyPos) {
      const infantry2: Unit = {
        id: `unit-${Date.now()}-${Math.random()}-2`,
        type: UnitType.INFANTRY,
        owner: chariot.owner,
        position: emptyPos,
        hp: 2,
        maxHp: 2,
        direction: chariot.direction,
        actionsThisTurn: canAct ? 0 : 2,
        hasMoved: !canAct,
        hasAttacked: !canAct,
      };
      addUnit(infantry2);
    }
  };

  // 辅助函数：检查某个玩家是否是仁德阵营
  const isRendeFaction = (player: Player): boolean => {
    const general = Object.values(units).find(u =>
      u.type === UnitType.GENERAL &&
      u.owner === player
    );
    return general !== undefined &&
           'generalType' in general &&
           general.generalType === 'rende';
  };

  // 获取可移动的位置（骑兵返回带步数信息的结果）
  const getValidMoves = (unit: Unit): (HexCoord & { steps?: number })[] => {
    // 计算行动次数上限（基础2次 + 额外行动次数）
    const bonusActions = (unit.type === UnitType.GENERAL && 'bonusActionLimit' in unit && typeof unit.bonusActionLimit === 'number') ? unit.bonusActionLimit : 0;
    const actionLimit = 2 + bonusActions;

    // 检查是否已达到行动次数上限
    if (unit.actionsThisTurn >= actionLimit) {
      return [];
    }

    // 如果没有额外行动次数，按照原来的规则：移动过就不能再移动
    if (bonusActions === 0 && unit.hasMoved) {
      return [];
    }

    // 战车特殊移动逻辑
    if (unit.type === UnitType.CHARIOT) {
      // 检查是否已行动
      if ('hasActedThisTurn' in unit && unit.hasActedThisTurn) return [];

      const dir1 = unit.owner === Player.PLAYER1 ? Direction.NORTH_WEST : Direction.SOUTH_WEST;
      const dir2 = unit.owner === Player.PLAYER1 ? Direction.NORTH_EAST : Direction.SOUTH_EAST;

      // 战车有3种移动终点：
      // 1. 正前方（先dir1后dir2，或先dir2后dir1，到达同一位置）
      // 2. 左侧（两次dir1）
      // 3. 右侧（两次dir2）

      // 正前方：先左上后右上（或先右上后左上）
      const mid_forward = hexNeighbor(unit.position, dir1);
      const end_forward = hexNeighbor(mid_forward, dir2);

      // 左侧：两次左上
      const mid_left = hexNeighbor(unit.position, dir1);
      const end_left = hexNeighbor(mid_left, dir1);

      // 右侧：两次右上
      const mid_right = hexNeighbor(unit.position, dir2);
      const end_right = hexNeighbor(mid_right, dir2);

      // 战车可以碾压敌人，检查每个终点的所有占用格子是否都在地图范围内
      const endpoints = [end_forward, end_left, end_right];
      return endpoints.filter(hex => {
        // 检查战车在这个位置时，所有占用的格子是否都在地图范围内
        const occupiedHexes = getMachineOccupiedHexes(hex, 'chariot');
        return occupiedHexes.every(occupiedHex => isInMapRange(occupiedHex, 5));
      });
    }

    // 弩车/投石车特殊移动逻辑：不能碾压，需要检查所有占用格子
    if (unit.type === UnitType.BALLISTA || unit.type === UnitType.CATAPULT) {
      // 检查是否已行动
      if ('hasActedThisTurn' in unit && unit.hasActedThisTurn) return [];

      const range = 1;
      const possibleMoves = hexRange(unit.position, range);
      const machineType = unit.type === UnitType.BALLISTA ? 'ballista' : 'catapult';

      // 过滤移动位置：需要检查机关占用的所有格子都没有障碍物
      return possibleMoves.filter(hex => {
        if (hexEquals(hex, unit.position)) return false;

        // 检查目标位置及其占用的所有格子
        const targetOccupiedHexes = getMachineOccupiedHexes(hex, machineType);

        // 检查是否有任何格子被占用
        const hasCollision = targetOccupiedHexes.some(occupiedHex =>
          Object.values(units).some(u => u.id !== unit.id && hexEquals(u.position, occupiedHex))
        );

        return !hasCollision && hexDistance(unit.position, hex) <= range;
      });
    }

    const range = unit.type === UnitType.CAVALRY ? 3 : 1; // 骑兵最多移动3格

    // 仁德将军本身移动范围+1（不适用于其他单位）
    let finalRange = range;
    if (unit.type === UnitType.GENERAL && isRendeFaction(unit.owner)) {
      finalRange = range + 1;
    }

    // 对于骑兵，使用BFS计算所有可达的格子（考虑路径阻挡）
    if (unit.type === UnitType.CAVALRY) {
      const reachable = new Map<string, number>(); // key: "q,r,s", value: 到达该格子的最短步数
      const queue: Array<{ pos: HexCoord, steps: number }> = [];
      const visited = new Set<string>();

      // 起点
      queue.push({ pos: unit.position, steps: 0 });
      visited.add(`${unit.position.q},${unit.position.r},${unit.position.s}`);

      while (queue.length > 0) {
        const current = queue.shift()!;

        // 如果已经达到移动上限，不再展开
        if (current.steps >= finalRange) continue;

        // 获取所有相邻格子
        const neighbors = hexNeighbors(current.pos);

        for (const neighbor of neighbors) {
          const neighborKey = `${neighbor.q},${neighbor.r},${neighbor.s}`;

          // 如果已访问过，跳过
          if (visited.has(neighborKey)) continue;

          // 检查是否在地图范围内
          if (!isInMapRange(neighbor, 5)) continue;

          // 检查是否被单位占用
          const occupiedByCore = Object.values(units).some(u =>
            hexEquals(u.position, neighbor) && u.id !== unit.id
          );

          // 检查是否被机关单位占据
          const occupiedByMachine = Object.values(units).some(u => {
            if (u.id === unit.id) return false;
            if (u.type !== UnitType.BALLISTA && u.type !== UnitType.CHARIOT && u.type !== UnitType.CATAPULT) return false;

            const machineType = u.type === UnitType.BALLISTA ? 'ballista' : u.type === UnitType.CATAPULT ? 'catapult' : 'chariot';
            const occupiedHexes = getMachineOccupiedHexes(u.position, machineType, u.owner === Player.PLAYER1);
            return occupiedHexes.some(occupiedHex => hexEquals(occupiedHex, neighbor));
          });

          // 如果被占用，这条路径不通，但继续尝试其他路径
          if (occupiedByCore || occupiedByMachine) {
            visited.add(neighborKey); // 标记为已访问，避免重复检查
            continue;
          }

          // 标记为已访问并加入队列
          visited.add(neighborKey);
          const nextSteps = current.steps + 1;
          queue.push({ pos: neighbor, steps: nextSteps });

          // 记录到达该格子的最短步数
          if (!reachable.has(neighborKey)) {
            reachable.set(neighborKey, nextSteps);
          }
        }
      }

      // 将结果转换为数组格式
      const result: (HexCoord & { steps: number })[] = [];
      for (const [key, steps] of reachable.entries()) {
        const [q, r, s] = key.split(',').map(Number);
        result.push({ q, r, s, steps });
      }

      return result;
    }

    // 非骑兵单位的移动逻辑
    const possibleMoves = hexRange(unit.position, finalRange);

    // 过滤掉已被占用的位置和不在地图范围内的位置
    return possibleMoves.filter(hex => {
      if (hexEquals(hex, unit.position)) return false;

      // 检查是否有其他单位的核心位置占用
      const occupiedByCore = Object.values(units).some(u =>
        hexEquals(u.position, hex) && u.id !== unit.id
      );

      if (occupiedByCore) return false;

      // 检查是否有机关单位的体积占用（弩车和战车占用多个格子）
      const occupiedByMachine = Object.values(units).some(u => {
        if (u.id === unit.id) return false;
        if (u.type !== UnitType.BALLISTA && u.type !== UnitType.CHARIOT) return false;

        const machineType = u.type === UnitType.BALLISTA ? 'ballista' : 'chariot';
        const occupiedHexes = getMachineOccupiedHexes(u.position, machineType);
        return occupiedHexes.some(occupiedHex => hexEquals(occupiedHex, hex));
      });

      if (occupiedByMachine) return false;

      return hexDistance(unit.position, hex) <= finalRange;
    });
  };

  // 获取可攻击的目标
  const getValidAttacks = (unit: Unit): Unit[] => {
    // 计算行动次数上限（基础2次 + 额外行动次数）
    const bonusActions = (unit.type === UnitType.GENERAL && 'bonusActionLimit' in unit && typeof unit.bonusActionLimit === 'number') ? unit.bonusActionLimit : 0;
    const actionLimit = 2 + bonusActions;

    // 检查是否已达到行动次数上限
    if (unit.actionsThisTurn >= actionLimit) {
      return [];
    }

    // 如果没有额外行动次数，按照原来的规则：攻击过就不能再攻击
    if (bonusActions === 0 && unit.hasAttacked) {
      return [];
    }

    // 无双将领不能进行普通攻击，只能使用扇形攻击技能
    if (unit.type === UnitType.GENERAL && 'generalType' in unit && unit.generalType === 'wushuang') {
      return [];
    }

    // 战车的攻击：使用最前面棋子的1格攻击范围
    if (unit.type === UnitType.CHARIOT) {
      // 检查是否已行动
      if ('hasActedThisTurn' in unit && unit.hasActedThisTurn) return [];

      // 找到最前面的棋子位置
      // 玩家1朝上：NORTH_EAST是最前面
      // 玩家2朝下：SOUTH_EAST是最前面
      const frontDir = unit.owner === Player.PLAYER1 ? Direction.NORTH_EAST : Direction.SOUTH_EAST;
      const frontPosition = hexNeighbor(unit.position, frontDir);

      // 获取该位置周围1格内的所有敌方单位（包括机关占用的格子）
      const neighbors = hexNeighbors(frontPosition);
      const targets: Unit[] = [];

      Object.values(units).forEach(target => {
        if (target.id === unit.id || target.owner === unit.owner) return;

        // 检查是否是机关单位
        if (target.type === UnitType.BALLISTA || target.type === UnitType.CHARIOT) {
          const machineType = target.type === UnitType.BALLISTA ? 'ballista' : 'chariot';
          const occupiedHexes = getMachineOccupiedHexes(target.position, machineType);

          // 检查机关占用的任何格子是否在攻击范围内
          const inRange = occupiedHexes.some(hex =>
            neighbors.some(n => hexEquals(n, hex))
          );
          if (inRange && !targets.some(t => t.id === target.id)) {
            targets.push(target);
          }
        } else {
          // 普通单位只检查中心位置
          if (neighbors.some(n => hexEquals(n, target.position))) {
            targets.push(target);
          }
        }
      });

      return targets;
    }

    const targets: Unit[] = [];

    // 投石车攻击：沿方向的射击路径
    if (unit.type === UnitType.CATAPULT) {
      // 检查是否已行动
      if ('hasActedThisTurn' in unit && unit.hasActedThisTurn) return [];

      const blockedPositions: HexCoord[] = [];

      // 只被敌方单位阻挡
      Object.values(units).forEach(u => {
        if (u.id === unit.id) return;
        if (u.owner !== unit.owner) {
          if (u.type === UnitType.BALLISTA || u.type === UnitType.CHARIOT || u.type === UnitType.CATAPULT) {
            const machineType = u.type === UnitType.BALLISTA ? 'ballista' :
                               u.type === UnitType.CHARIOT ? 'chariot' : 'catapult';
            const occupiedHexes = getMachineOccupiedHexes(u.position, machineType);
            blockedPositions.push(...occupiedHexes);
          } else {
            blockedPositions.push(u.position);
          }
        }
      });

      const shootingPath = getShootingPath(
        unit.position,
        unit.direction,
        5,
        blockedPositions
      );

      shootingPath.forEach(hexPos => {
        const enemy = Object.values(units).find(u => {
          if (u.owner === unit.owner || u.id === unit.id) return false;
          if (u.type === UnitType.BALLISTA || u.type === UnitType.CHARIOT || u.type === UnitType.CATAPULT) {
            const machineType = u.type === UnitType.BALLISTA ? 'ballista' :
                               u.type === UnitType.CHARIOT ? 'chariot' : 'catapult';
            const occupiedHexes = getMachineOccupiedHexes(u.position, machineType);
            return occupiedHexes.some(hex => hexEquals(hex, hexPos));
          }
          return hexEquals(u.position, hexPos);
        });
        if (enemy && !targets.some(t => t.id === enemy.id)) {
          targets.push(enemy);
        }
      });

      return targets;
    }

    if (unit.type === UnitType.ARCHER || unit.type === UnitType.BALLISTA) {
      // 弓箭手新射程规则：range = 3 + hex_distance(archer_cell, own_baseline)
      let maxRange = 5; // 默认地图半径

      if (unit.type === UnitType.ARCHER) {
        const playerSide = unit.owner === Player.PLAYER1 ? 'top' : 'bottom';
        const distToBaseline = getDistanceToBaseline(unit.position, playerSide);
        maxRange = 3 + distToBaseline;
      }

      // 弓箭手/弩车：使用射击路径计算
      // 只被敌方单位阻挡，友方的弩车和战车不阻挡射击
      const blockedPositions: HexCoord[] = [];

      Object.values(units).forEach(u => {
        if (u.id === unit.id) return;

        // 友方的弩车和战车不阻挡射击
        if (u.owner === unit.owner && (u.type === UnitType.BALLISTA || u.type === UnitType.CHARIOT)) {
          return;
        }

        // 敌方单位会阻挡
        if (u.owner !== unit.owner) {
          // 检查机关单位的所有占用格子
          if (u.type === UnitType.BALLISTA || u.type === UnitType.CHARIOT) {
            const machineType = u.type === UnitType.BALLISTA ? 'ballista' : 'chariot';
            const occupiedHexes = getMachineOccupiedHexes(u.position, machineType);
            blockedPositions.push(...occupiedHexes);
          } else {
            blockedPositions.push(u.position);
          }
        }
      });

      const shootingPath = getShootingPath(
        unit.position,
        unit.direction,
        maxRange, // 使用计算后的射程
        blockedPositions // 被阻挡的位置
      );

      // 在射击路径上找到所有敌人（包括机关占用的格子）
      shootingPath.forEach(hexPos => {
        const enemy = Object.values(units).find(u => {
          if (u.owner === unit.owner || u.id === unit.id) return false;

          // 检查是否是机关单位
          if (u.type === UnitType.BALLISTA || u.type === UnitType.CHARIOT) {
            const machineType = u.type === UnitType.BALLISTA ? 'ballista' : 'chariot';
            const occupiedHexes = getMachineOccupiedHexes(u.position, machineType);
            return occupiedHexes.some(hex => hexEquals(hex, hexPos));
          }

          // 普通单位只检查中心位置
          return hexEquals(u.position, hexPos);
        });
        if (enemy && !targets.some(t => t.id === enemy.id)) {
          targets.push(enemy);
        }
      });
    } else {
      // 近战单位：1格范围（包括机关占用的格子）
      Object.values(units).forEach(target => {
        if (target.owner === unit.owner || target.id === unit.id) return;

        // 检查是否是机关单位
        if (target.type === UnitType.BALLISTA || target.type === UnitType.CHARIOT) {
          const machineType = target.type === UnitType.BALLISTA ? 'ballista' : 'chariot';
          const occupiedHexes = getMachineOccupiedHexes(target.position, machineType);

          // 检查机关占用的任何格子是否在攻击范围内
          const inRange = occupiedHexes.some(hex => hexDistance(unit.position, hex) === 1);
          if (inRange) {
            targets.push(target);
          }
        } else {
          // 普通单位只检查中心位置
          if (hexDistance(unit.position, target.position) === 1) {
            targets.push(target);
          }
        }
      });
    }

    return targets;
  };

  // 移动单位
  const moveUnit = (unit: Unit, to: HexCoord) => {
    if (currentActionPoints < 1) return false;

    // 计算行动次数上限（基础2次 + 额外行动次数）
    const bonusActions = (unit.type === UnitType.GENERAL && 'bonusActionLimit' in unit && typeof unit.bonusActionLimit === 'number') ? unit.bonusActionLimit : 0;
    const actionLimit = 2 + bonusActions;

    // 检查是否已达到行动次数上限
    if (unit.actionsThisTurn >= actionLimit) return false;

    // 如果没有额外行动次数，按照原来的规则：移动过就不能再移动
    if (bonusActions === 0 && unit.hasMoved) return false;

    const validMoves = getValidMoves(unit);
    if (!validMoves.some(hex => hexEquals(hex, to))) return false;

    // 骑兵特殊逻辑：记录移动距离
    let moveDistance = 1;
    if (unit.type === UnitType.CAVALRY) {
      moveDistance = hexDistance(unit.position, to);
    }

    // 弩车移动后标记为已行动（每回合只能1个动作）
    if (unit.type === UnitType.BALLISTA) {
      updateUnit(unit.id, {
        position: to,
        hasMoved: true,
        hasActedThisTurn: true,
        actionsThisTurn: unit.actionsThisTurn + 1,
      } as any);
    } else if (unit.type === UnitType.CAVALRY) {
      // 骑兵：记录移动距离
      updateUnit(unit.id, {
        position: to,
        hasMoved: true,
        actionsThisTurn: unit.actionsThisTurn + 1,
        moveDistance: moveDistance,
      });
    } else {
      updateUnit(unit.id, {
        position: to,
        hasMoved: true,
        actionsThisTurn: unit.actionsThisTurn + 1,
      });
    }

    consumeActionPoint(currentPlayer);

    // 检查是否触碰到敌方大本营（战车除外）
    const enemyBase = unit.owner === Player.PLAYER1 ? player2Base : player1Base;
    if (enemyBase && hexEquals(to, enemyBase) && unit.type !== UnitType.CHARIOT) {
      // 非战车单位触底，直接获胜！
      alert(`${unit.owner === Player.PLAYER1 ? '玩家1' : '玩家2'} 获胜！`);
      setPhase('end' as any);
    }

    return true;
  };

  // 攻击单位
  const attackUnit = (attacker: Unit, target: Unit) => {
    // 检查是否攻击自己的单位
    if (attacker.owner === target.owner) return false;

    // 检查是否为非将领单位攻击将领，需要额外+1行动值
    const isNonGeneralAttackingGeneral =
      attacker.type !== UnitType.GENERAL && target.type === UnitType.GENERAL;
    let requiredActionPoints = isNonGeneralAttackingGeneral ? 2 : 1;

    // 弓箭手特殊：计算越射己方单位的代价
    if (attacker.type === UnitType.ARCHER) {
      // 计算从弓箭手到目标的射击路径
      const pathToTarget = [];
      let current = hexNeighbor(attacker.position, attacker.direction);
      while (isInMapRange(current, 5) && !hexEquals(current, target.position)) {
        pathToTarget.push(current);
        current = hexNeighbor(current, attacker.direction);
      }

      // 统计路径上的己方单位数量
      let friendlyUnitsInPath = 0;
      pathToTarget.forEach(hexPos => {
        const unitAtPos = Object.values(units).find(u =>
          u.owner === attacker.owner &&
          u.id !== attacker.id &&
          hexEquals(u.position, hexPos)
        );
        if (unitAtPos) {
          friendlyUnitsInPath++;
        }
      });

      // 每越过一个己方单位，额外消耗1点行动点
      requiredActionPoints += friendlyUnitsInPath;
    }

    if (currentActionPoints < requiredActionPoints) return false;

    // 计算行动次数上限（基础2次 + 额外行动次数）
    const bonusActions = (attacker.type === UnitType.GENERAL && 'bonusActionLimit' in attacker && typeof attacker.bonusActionLimit === 'number') ? attacker.bonusActionLimit : 0;
    const actionLimit = 2 + bonusActions;

    // 检查是否已达到行动次数上限
    if (attacker.actionsThisTurn >= actionLimit) return false;

    // 如果没有额外行动次数，按照原来的规则：攻击过就不能再攻击
    if (bonusActions === 0 && attacker.hasAttacked) return false;

    const validTargets = getValidAttacks(attacker);
    if (!validTargets.some(t => t.id === target.id)) return false;

    // 检查目标是否无敌（无双将军技能）
    if (target.type === UnitType.GENERAL && 'isInvincible' in target && target.isInvincible) {
      // 无敌状态，不受伤害，但消耗攻击者的行动
      updateUnit(attacker.id, {
        hasAttacked: true,
        actionsThisTurn: attacker.actionsThisTurn + 1,
      });
      // 非将领攻击将领时消耗额外行动点
      for (let i = 0; i < requiredActionPoints; i++) {
        consumeActionPoint(currentPlayer);
      }
      return false; // 攻击无效
    }

    // === 步兵纵深抗击规则检查 ===
    let depthDefenseTriggered = false;
    let rearInfantryId: string | null = null;

    if (target.type === UnitType.INFANTRY) {
      // 确定攻击来源格（source_cell）
      const sourceCell = attacker.position;

      // 获取攻击反方向轴线上的所有格子
      const axisLine = getAxisLineFromTarget(target.position, sourceCell, 5);

      // 在轴线上查找己方步兵
      const rearInfantries = axisLine
        .map(hexPos => Object.values(units).find(u =>
          u.type === UnitType.INFANTRY &&
          u.owner === target.owner &&
          hexEquals(u.position, hexPos)
        ))
        .filter(u => u !== undefined) as Unit[];

      if (rearInfantries.length > 0) {
        // 触发纵深抗击！
        depthDefenseTriggered = true;

        // 找到最远的后排步兵
        const rearInfantry = rearInfantries.reduce((furthest, current) => {
          const furthestDist = hexDistance(furthest.position, sourceCell);
          const currentDist = hexDistance(current.position, sourceCell);
          return currentDist > furthestDist ? current : furthest;
        });

        rearInfantryId = rearInfantry.id;

        // Step 2: 击退后排步兵（向远离source的方向击退1格）
        // 重新计算从rearInfantry出发的轴线，获取其后方第一个格子
        const rearAxisLine = getAxisLineFromTarget(rearInfantry.position, sourceCell, 5);
        const retreatTarget = rearAxisLine.length > 0 ? rearAxisLine[0] : null;

        if (retreatTarget) {
          // 检查击退目标格是否可通过
          const canRetreat = !Object.values(units).some(u => hexEquals(u.position, retreatTarget)) &&
                            isInMapRange(retreatTarget, 5);

          if (canRetreat) {
            // 可以击退
            updateUnit(rearInfantry.id, {
              position: retreatTarget,
            });
          } else {
            // Step 3: 无法击退，惩罚后排步兵
            const newHp = rearInfantry.hp - 1;
            if (newHp <= 0) {
              removeUnit(rearInfantry.id);
            } else {
              updateUnit(rearInfantry.id, {
                hp: newHp,
              });
            }
          }
        } else {
          // 后方没有格子（已到地图边缘），无法击退，惩罚
          const newHp = rearInfantry.hp - 1;
          if (newHp <= 0) {
            removeUnit(rearInfantry.id);
          } else {
            updateUnit(rearInfantry.id, {
              hp: newHp,
            });
          }
        }

        // Step 4: 限制前排机动
        updateUnit(target.id, {
          movementRestricted: true,
        });
      }
    }

    // 如果触发了纵深抗击，本次攻击不造成伤害（Step 1: 免伤）
    if (depthDefenseTriggered) {
      // 攻击者依然消耗行动
      updateUnit(attacker.id, {
        hasAttacked: true,
        actionsThisTurn: attacker.actionsThisTurn + 1,
      });

      // 非将领攻击将领时消耗额外行动点
      for (let i = 0; i < requiredActionPoints; i++) {
        consumeActionPoint(currentPlayer);
      }

      return true; // 攻击成功但免伤
    }

    // 造成伤害
    let damage = 1;

    // 骑兵：根据移动距离调整伤害
    if (attacker.type === UnitType.CAVALRY && 'moveDistance' in attacker) {
      const moveDistance = (attacker as any).moveDistance || 0;
      if (moveDistance === 3) {
        // 移动3格无法攻击
        return false;
      } else if (moveDistance === 2) {
        // 移动2格伤害+1
        damage = 2;
      }
      // 移动1格：默认伤害1
    }

    // 弩车受近战攻击伤害+1
    if (target.type === UnitType.BALLISTA) {
      // 如果攻击者是骑兵且移动2格，则伤害为2（已设置），不再叠加
      if (attacker.type !== UnitType.CAVALRY || ((attacker as any).moveDistance || 0) !== 2) {
        damage = 2;
      } else {
        damage = 2; // 骑兵移动2格攻击弩车，伤害也是2（不叠加）
      }
    }

    const newHp = target.hp - damage;

    if (newHp <= 0) {
      // 骑兵掉马：生成一个体力为1的步兵
      if (target.type === UnitType.CAVALRY) {
        updateUnit(target.id, {
          type: UnitType.INFANTRY,
          hp: 1,
          maxHp: 2,
        });
      } else {
        // 检查是否是仁德阵营的击杀，如果是则不立即处理
        if (isRendeFaction(attacker.owner)) {
          // 仁德阵营击杀：标记单位为待确认状态，由UI处理
          // 这里我们返回一个特殊状态，让调用方处理
          updateUnit(attacker.id, {
            hasAttacked: true,
            actionsThisTurn: attacker.actionsThisTurn + 1,
          });

          // 非将领攻击将领时消耗额外行动点
          for (let i = 0; i < requiredActionPoints; i++) {
            consumeActionPoint(currentPlayer);
          }

          // 返回特殊值，表示需要UI确认
          return 'rende_kill_confirm' as any;
        }

        // 目标被击杀
        removeUnit(target.id);
        recordKill(currentPlayer);

        // 如果被击杀的是中立单位标记，重置仁德将领的转化费用
        if (target.type === UnitType.NEUTRAL_MARKER && target.owner === Player.NEUTRAL) {
          // 找到击杀者所属阵营的仁德将领
          const rendeGeneral = Object.values(units).find(u =>
            u.type === UnitType.GENERAL &&
            u.owner === attacker.owner &&
            'generalType' in u &&
            (u as any).generalType === 'rende'
          );

          if (rendeGeneral) {
            // 重置转化费用为1
            updateUnit(rendeGeneral.id, {
              convertInfantryCost: 1,
            } as any);
          }
        }

        // 如果是将军被击杀，永久减少骰子
        if (target.type === UnitType.GENERAL) {
          useGameStore.getState().removeDice(target.owner, 1);
        }

        // 弩车被击杀：贯穿过3个及以上单位（包含友方），神机将军的拥有者获得重投机会
        if (target.type === UnitType.BALLISTA) {
          if ('pierceCount' in target && (target as any).pierceCount >= 3) {
            // 贯穿过3个及以上单位，神机将军的拥有者获得重投机会
            useGameStore.getState().addRerollToken(target.owner);
          }
        }

        // 战车被击杀：如果碾死过人，神机将军的拥有者获得重投机会
        if (target.type === UnitType.CHARIOT) {
          if ('killCount' in target && (target as any).killCount > 0) {
            useGameStore.getState().addRerollToken(target.owner);
          }
        }
      }
    } else {
      // 其他单位受伤，直接减血
      updateUnit(target.id, {
        hp: newHp,
      });
    }

    updateUnit(attacker.id, {
      hasAttacked: true,
      actionsThisTurn: attacker.actionsThisTurn + 1,
    });

    // 非将领攻击将领时消耗额外行动点
    for (let i = 0; i < requiredActionPoints; i++) {
      consumeActionPoint(currentPlayer);
    }

    return true;
  };

  // 转向（弓箭手/投石车）
  const rotateUnit = (unit: Unit, direction: Direction) => {
    if (currentActionPoints < 1) return false;
    if (unit.actionsThisTurn >= 2) return false;

    // 弓箭手和投石车可以转向，弩车方向固定
    if (unit.type === UnitType.CATAPULT) {
      // 投石车转向使用专用函数（考虑蓄力代价）
      return catapultRotate(unit, direction);
    }

    if (unit.type !== UnitType.ARCHER) return false;

    updateUnit(unit.id, {
      direction,
      actionsThisTurn: unit.actionsThisTurn + 1,
    });

    consumeActionPoint(currentPlayer);

    return true;
  };

  // 部署单位
  const deployUnit = (unitType: UnitType, position: HexCoord, direction: Direction = Direction.EAST) => {
    if (currentActionPoints < 1) return false;

    // 允许在任何位置部署（包括敌方部署区）
    // 只需检查是否在地图范围内
    if (!isInMapRange(position, 5)) return false;

    // 检查位置是否被占用
    const occupied = Object.values(units).some(u => hexEquals(u.position, position));
    if (occupied) return false;

    // 如果是将军,需要获取玩家选择的将军类型
    const generalType = currentPlayer === Player.PLAYER1
      ? useGameStore.getState().player1General
      : useGameStore.getState().player2General;

    // 根据将军类型设置体力上限
    let hp = 2;
    let maxHp = 2;
    if (unitType === UnitType.GENERAL && generalType) {
      if (generalType === 'wushuang' || generalType === 'rende') {
        hp = 4;
        maxHp = 4;
      } else if (generalType === 'shenji') {
        hp = 3;
        maxHp = 3;
      }
    }

    // 机关单位特殊处理
    if (unitType === UnitType.BALLISTA || unitType === UnitType.CHARIOT) {
      hp = 4;
      maxHp = 4;
    }

    const newUnit: Unit = {
      id: `unit-${Date.now()}-${Math.random()}`,
      type: unitType,
      owner: currentPlayer,
      position,
      hp,
      maxHp,
      direction,
      actionsThisTurn: 1, // 部署算一次行动
      hasMoved: false,
      hasAttacked: false,
      ...(unitType === UnitType.GENERAL && generalType ? {
        generalType,
        abilityUsed: false,
        isInvincible: false,
        unlimitedActions: false,
        hasFanAttacked: false,
      } : {}),
      ...(unitType === UnitType.BALLISTA || unitType === UnitType.CHARIOT ? {
        killCount: 0,
        pierceCount: 0,
        hasActedThisTurn: false,
      } : {}),
    };

    addUnit(newUnit);
    consumeActionPoint(currentPlayer);

    return true;
  };

  // 部署机关单位（神机专属）
  const deployMachine = (machineType: UnitType.BALLISTA | UnitType.CHARIOT | UnitType.CATAPULT, position: HexCoord) => {
    // 弩车消耗3点，战车消耗4点，投石车消耗3点
    const requiredPoints = machineType === UnitType.BALLISTA ? 3 :
                          machineType === UnitType.CHARIOT ? 4 : 3;
    if (currentActionPoints < requiredPoints) return false;

    // 检查玩家是否是神机将军
    const generalType = currentPlayer === Player.PLAYER1
      ? useGameStore.getState().player1General
      : useGameStore.getState().player2General;

    if (generalType !== 'shenji') return false;

    // 允许在任何位置部署（包括敌方部署区）
    // 只需检查是否在地图范围内
    if (!isInMapRange(position, 5)) return false;

    // 获取机关单位占用的所有格子
    const machineTypeStr = machineType === UnitType.BALLISTA ? 'ballista' :
                          machineType === UnitType.CHARIOT ? 'chariot' : 'catapult';
    const occupiedHexes = getMachineOccupiedHexes(position, machineTypeStr);

    // 检查所有占用的格子是否都未被占用
    const hasCollision = occupiedHexes.some(hex =>
      Object.values(units).some(u => hexEquals(u.position, hex))
    );

    if (hasCollision) return false;

    // 检查库存
    const currentArmy = currentPlayer === Player.PLAYER1
      ? useGameStore.getState().player1Army
      : useGameStore.getState().player2Army;

    const consumedStock = currentPlayer === Player.PLAYER1
      ? useGameStore.getState().player1ConsumedStock
      : useGameStore.getState().player2ConsumedStock;

    // 计算剩余可用库存
    const availableInfantry = currentArmy.infantry - consumedStock.infantry;
    const availableArcher = currentArmy.archer - consumedStock.archer;

    if (machineType === UnitType.BALLISTA) {
      // 弩车需要: 4个步兵 + 1个弓箭手
      if (availableInfantry < 4 || availableArcher < 1) {
        return false;
      }
    } else if (machineType === UnitType.CHARIOT) {
      // 战车需要: 6个步兵
      if (availableInfantry < 6) {
        return false;
      }
    } else if (machineType === UnitType.CATAPULT) {
      // 投石车需要: 2个步兵 + 1个弓箭手
      if (availableInfantry < 2 || availableArcher < 1) {
        return false;
      }
    }

    // 弩车固定朝向"前方"（玩家1朝北/上方，玩家2朝南/下方）
    // 投石车可转向，初始朝向也是前方
    const direction = currentPlayer === Player.PLAYER1 ? Direction.NORTH : Direction.SOUTH;

    const newMachine: any = {
      id: `unit-${Date.now()}-${Math.random()}`,
      type: machineType,
      owner: currentPlayer,
      position,
      hp: 4,
      maxHp: 4,
      direction,
      actionsThisTurn: 0, // 机关刚部署时行动次数为0
      hasMoved: false,
      hasAttacked: false,
      killCount: 0,
      pierceCount: 0,
      hasActedThisTurn: false,
      ...(machineType === UnitType.CATAPULT ? { chargeLevel: 0 } : {}),
    };

    // 成功部署后才扣除库存（增加已消耗库存）
    addUnit(newMachine);

    if (machineType === UnitType.BALLISTA) {
      // 扣除弩车库存：4个步兵 + 1个弓箭手
      if (currentPlayer === Player.PLAYER1) {
        useGameStore.setState({
          player1ConsumedStock: {
            ...consumedStock,
            infantry: consumedStock.infantry + 4,
            archer: consumedStock.archer + 1,
          }
        });
      } else {
        useGameStore.setState({
          player2ConsumedStock: {
            ...consumedStock,
            infantry: consumedStock.infantry + 4,
            archer: consumedStock.archer + 1,
          }
        });
      }
    } else if (machineType === UnitType.CHARIOT) {
      // 扣除战车库存：6个步兵
      if (currentPlayer === Player.PLAYER1) {
        useGameStore.setState({
          player1ConsumedStock: {
            ...consumedStock,
            infantry: consumedStock.infantry + 6,
          }
        });
      } else {
        useGameStore.setState({
          player2ConsumedStock: {
            ...consumedStock,
            infantry: consumedStock.infantry + 6,
          }
        });
      }
    } else if (machineType === UnitType.CATAPULT) {
      // 扣除投石车库存：2个步兵 + 1个弓箭手
      if (currentPlayer === Player.PLAYER1) {
        useGameStore.setState({
          player1ConsumedStock: {
            ...consumedStock,
            infantry: consumedStock.infantry + 2,
            archer: consumedStock.archer + 1,
          }
        });
      } else {
        useGameStore.setState({
          player2ConsumedStock: {
            ...consumedStock,
            infantry: consumedStock.infantry + 2,
            archer: consumedStock.archer + 1,
          }
        });
      }
    }

    // 消耗对应的行动点：弩车3点，战车4点，投石车3点
    for (let i = 0; i < requiredPoints; i++) {
      consumeActionPoint(currentPlayer);
    }

    return true;
  };

  // 弩车贯穿攻击
  const ballistaAttack = (ballista: Unit) => {
    if (currentActionPoints < 1) return false;
    if (ballista.type !== UnitType.BALLISTA) return false;

    // 检查是否已行动
    if ('hasActedThisTurn' in ballista && ballista.hasActedThisTurn) return false;

    // 使用垂直贯穿路径（正北或正南）
    const isPlayerOne = ballista.owner === Player.PLAYER1;
    const shootingPath = getBallistaVerticalPath(ballista.position, isPlayerOne, 5);

    // 找到路径上的所有单位（贯穿所有，包括友方，包括机关占用的格子）
    const hitUnits: Unit[] = [];
    const hitUnitsIds = new Set<string>();

    shootingPath.forEach((hexPos: HexCoord) => {
      const unit = Object.values(units).find((u: Unit) => {
        if (u.id === ballista.id || hitUnitsIds.has(u.id)) return false;

        // 检查是否是机关单位
        if (u.type === UnitType.BALLISTA || u.type === UnitType.CHARIOT) {
          const machineType = u.type === UnitType.BALLISTA ? 'ballista' : 'chariot';
          const occupiedHexes = getMachineOccupiedHexes(u.position, machineType);
          return occupiedHexes.some(hex => hexEquals(hex, hexPos));
        }

        // 普通单位只检查中心位置
        return hexEquals(u.position, hexPos);
      });

      if (unit) {
        hitUnits.push(unit);
        hitUnitsIds.add(unit.id);
      }
    });

    if (hitUnits.length === 0) return false;

    // 新规则：贯穿攻击效果
    const firstUnit = hitUnits[0]; // 第一个命中的单位
    const lastUnit = hitUnits[hitUnits.length - 1]; // 最后一个命中的单位

    // 结算第一个单位：尝试击退
    const firstAxisLine = getAxisLineFromTarget(firstUnit.position, ballista.position, 5);
    const firstRetreatTarget = firstAxisLine.length > 0 ? firstAxisLine[0] : null;

    if (firstRetreatTarget) {
      const canRetreat = !Object.values(units).some(u => hexEquals(u.position, firstRetreatTarget)) &&
                        isInMapRange(firstRetreatTarget, 5);

      if (canRetreat) {
        // 可以击退
        updateUnit(firstUnit.id, {
          position: firstRetreatTarget,
        });
      } else {
        // 无法击退，造成1点伤害
        const newHp = firstUnit.hp - 1;
        if (newHp <= 0) {
          // 骑兵掉马
          if (firstUnit.type === UnitType.CAVALRY) {
            updateUnit(firstUnit.id, {
              type: UnitType.INFANTRY,
              hp: 1,
              maxHp: 2,
            });
          } else {
            removeUnit(firstUnit.id);
            if (firstUnit.owner !== ballista.owner) {
              recordKill(currentPlayer);
            }
            if (firstUnit.type === UnitType.GENERAL) {
              useGameStore.getState().removeDice(firstUnit.owner, 1);
            }
          }
        } else {
          updateUnit(firstUnit.id, {
            hp: newHp,
          });
        }
      }
    }

    // 结算最后一个单位：下回合不能移动/转向
    updateUnit(lastUnit.id, {
      cannotActNextTurn: true,
    });

    // 如果first和last是同一单位，上述两效果同时作用（已处理）

    // 更新弩车状态
    updateUnit(ballista.id, {
      hasAttacked: true,
      hasActedThisTurn: true,
      actionsThisTurn: ballista.actionsThisTurn + 1,
      pierceCount: ('pierceCount' in ballista ? (ballista as any).pierceCount : 0) + hitUnits.length,
    } as any);

    consumeActionPoint(currentPlayer);

    return true;
  };

  // 弩车近战攻击
  const ballistaMeleeAttack = (ballista: Unit, target: Unit) => {
    if (currentActionPoints < 1) return false;
    if (ballista.type !== UnitType.BALLISTA) return false;

    // 检查是否已行动
    if ('hasActedThisTurn' in ballista && ballista.hasActedThisTurn) return false;

    // 检查是否攻击敌方
    if (target.owner === ballista.owner) return false;

    // 检查目标是否与弩车相邻
    // 获取弩车所有占用的格子
    const ballistaOccupiedHexes = getMachineOccupiedHexes(ballista.position, 'ballista');

    // 获取目标所有占用的格子（可能是机关单位）
    let targetOccupiedHexes: HexCoord[];
    if (target.type === UnitType.BALLISTA) {
      targetOccupiedHexes = getMachineOccupiedHexes(target.position, 'ballista');
    } else if (target.type === UnitType.CHARIOT) {
      targetOccupiedHexes = getMachineOccupiedHexes(target.position, 'chariot');
    } else {
      targetOccupiedHexes = [target.position];
    }

    // 检查弩车的任意占用格子是否与目标的任意占用格子相邻
    let isAdjacent = false;
    for (const ballistaHex of ballistaOccupiedHexes) {
      for (const targetHex of targetOccupiedHexes) {
        if (hexDistance(ballistaHex, targetHex) === 1) {
          isAdjacent = true;
          break;
        }
      }
      if (isAdjacent) break;
    }

    if (!isAdjacent) return false;

    // 弩车近战攻击伤害为1
    const newHp = target.hp - 1;

    if (newHp <= 0) {
      // 目标被击杀
      removeUnit(target.id);

      // 增加击杀计数
      if ('killCount' in ballista) {
        updateUnit(ballista.id, {
          killCount: (ballista as any).killCount + 1,
        } as any);
      }

      // 如果击杀的是将军，永久减少骰子
      if (target.type === UnitType.GENERAL) {
        useGameStore.getState().removeDice(target.owner, 1);
      }

      // 记录击杀
      recordKill(currentPlayer);
    }
    // 注意：目标受伤/死亡的状态变更由服务端同步，客户端不做预测

    // 更新弩车状态
    updateUnit(ballista.id, {
      hasAttacked: true,
      hasActedThisTurn: true,
      actionsThisTurn: ballista.actionsThisTurn + 1,
    } as any);

    consumeActionPoint(currentPlayer);

    return true;
  };

  // 战车碾压移动
  const chariotMove = (chariot: Unit, to: HexCoord) => {
    if (currentActionPoints < 1) return false;
    if (chariot.type !== UnitType.CHARIOT) return false;

    // 检查是否已行动
    if ('hasActedThisTurn' in chariot && chariot.hasActedThisTurn) return false;

    // 战车移动距离必须为2
    const distance = hexDistance(chariot.position, to);
    if (distance !== 2) return false;

    // 计算移动方向
    const dy = to.r - chariot.position.r;

    // 玩家1（上方）：只能朝上方移动（r减少）
    // 玩家2（下方）：只能朝下方移动（r增加）
    const isValidDirection = chariot.owner === Player.PLAYER1
      ? dy < 0  // r减少，朝向上方
      : dy > 0; // r增加，朝向下方

    if (!isValidDirection) return false;

    // 战车有3种移动方式，使用与getValidMoves相同的计算方式
    const dir1 = chariot.owner === Player.PLAYER1 ? Direction.NORTH_WEST : Direction.SOUTH_WEST;
    const dir2 = chariot.owner === Player.PLAYER1 ? Direction.NORTH_EAST : Direction.SOUTH_EAST;

    // 计算三个终点（与getValidMoves中的逻辑一致）
    const mid_forward = hexNeighbor(chariot.position, dir1);
    const end_forward = hexNeighbor(mid_forward, dir2);

    const mid_left = hexNeighbor(chariot.position, dir1);
    const end_left = hexNeighbor(mid_left, dir1);

    const mid_right = hexNeighbor(chariot.position, dir2);
    const end_right = hexNeighbor(mid_right, dir2);

    // 检查目标是否是这3个有效终点之一，并计算路径
    let validPath: HexCoord[] | null = null;

    if (hexEquals(to, end_forward)) {
      // 正前方：先dir1后dir2
      validPath = [mid_forward, end_forward];
    } else if (hexEquals(to, end_left)) {
      // 左前方：两次dir1
      validPath = [mid_left, end_left];
    } else if (hexEquals(to, end_right)) {
      // 右前方：两次dir2
      validPath = [mid_right, end_right];
    }

    if (!validPath) return false;

    // 战车移动时，需要检查战车在整个移动路径中占用的所有格子
    // 收集路径上所有被战车占用的格子（包括起点、中点、终点的战车占用格子）
    const allOccupiedHexes = new Set<string>();

    // 起点的战车占用格子
    const startOccupied = getMachineOccupiedHexes(chariot.position, 'chariot');
    startOccupied.forEach(hex => allOccupiedHexes.add(`${hex.q},${hex.r},${hex.s}`));

    // 路径上每个点的战车占用格子
    validPath.forEach(pathHex => {
      const occupied = getMachineOccupiedHexes(pathHex, 'chariot');
      occupied.forEach(hex => allOccupiedHexes.add(`${hex.q},${hex.r},${hex.s}`));
    });

    // 检查所有这些格子上的单位并碾压
    let killedCount = 0;
    const killedUnits = new Set<string>(); // 防止重复计数
    const crushedMachines: Unit[] = []; // 记录被碾压的机关单位

    allOccupiedHexes.forEach(hexKey => {
      const [q, r, s] = hexKey.split(',').map(Number);
      const hex = { q, r, s };

      const victim = Object.values(units).find(u => {
        if (u.id === chariot.id) return false;
        if (killedUnits.has(u.id)) return false; // 已经被碾压过

        // 检查普通单位
        if (hexEquals(u.position, hex)) return true;

        // 检查机关单位的占用格子
        if (u.type === UnitType.BALLISTA || u.type === UnitType.CHARIOT) {
          const machineType = u.type === UnitType.BALLISTA ? 'ballista' : 'chariot';
          const occupiedHexes = getMachineOccupiedHexes(u.position, machineType);
          return occupiedHexes.some(occupiedHex => hexEquals(occupiedHex, hex));
        }

        return false;
      });

      if (victim && !killedUnits.has(victim.id)) {
        // 如果碾压到机关单位，记录下来特殊处理
        if (victim.type === UnitType.BALLISTA || victim.type === UnitType.CHARIOT) {
          if (!crushedMachines.find(m => m.id === victim.id)) {
            crushedMachines.push(victim);
          }
        } else {
          // 普通单位直接击杀
          removeUnit(victim.id);
          killedUnits.add(victim.id);
          killedCount++;

          // 如果是将军，永久减少骰子
          if (victim.type === UnitType.GENERAL) {
            useGameStore.getState().removeDice(victim.owner, 1);
          }

          // 记录击杀（只统计敌方）
          if (victim.owner !== chariot.owner) {
            recordKill(currentPlayer);
          }
        }
      }
    });

    // 如果碾压到机关单位，处理机关崩解
    if (crushedMachines.length > 0) {
      // 碾压方的战车先崩解（步兵不可行动）
      handleChariotDeath(chariot, false);
      removeUnit(chariot.id);

      // 再处理被碾压的机关单位的崩解
      crushedMachines.forEach(crushedMachine => {
        if (crushedMachine.type === UnitType.CHARIOT) {
          // 被碾压的战车崩解为2个不可行动的步兵
          handleChariotDeath(crushedMachine, false);
          removeUnit(crushedMachine.id);
        } else {
          // 弩车直接删除
          removeUnit(crushedMachine.id);
        }
      });

      // 战车已崩解，消耗行动点后返回
      consumeActionPoint(currentPlayer);
      return true;
    }

    // 战车移动到目标位置
    const newHp = chariot.hp - killedCount;

    // 检查是否触底（到达敌方大本营）
    const enemyBase = chariot.owner === Player.PLAYER1 ? player2Base : player1Base;
    const reachedBase = enemyBase && hexEquals(to, enemyBase);

    if (reachedBase) {
      // 战车触底：崩解为2个可行动的步兵，剩余血量转为行动点
      removeUnit(chariot.id);

      // 将剩余血量转为行动点
      const actionPoints = currentPlayer === Player.PLAYER1 ? player1ActionPoints : player2ActionPoints;
      if (currentPlayer === Player.PLAYER1) {
        useGameStore.setState({ player1ActionPoints: actionPoints + newHp });
      } else {
        useGameStore.setState({ player2ActionPoints: actionPoints + newHp });
      }

      // 生成2个满血可行动步兵
      const infantry1: Unit = {
        id: `unit-${Date.now()}-${Math.random()}`,
        type: UnitType.INFANTRY,
        owner: currentPlayer,
        position: to,
        hp: 2,
        maxHp: 2,
        direction: chariot.direction,
        actionsThisTurn: 0, // 可以行动
        hasMoved: false,
        hasAttacked: false,
      };

      const neighbors = hexNeighbors(to);
      const emptyPos = neighbors.find(pos => {
        // 检查是否有单位占用
        const hasUnit = Object.values(units).some(u => hexEquals(u.position, pos));
        if (hasUnit) return false;

        // 检查是否被机关单位占据
        const occupiedByMachine = Object.values(units).some(u => {
          if (u.type === UnitType.BALLISTA || u.type === UnitType.CHARIOT) {
            const machineType = u.type === UnitType.BALLISTA ? 'ballista' : 'chariot';
            const occupied = getMachineOccupiedHexes(u.position, machineType);
            return occupied.some(hex => hexEquals(hex, pos));
          }
          return false;
        });

        return !occupiedByMachine;
      });

      if (emptyPos) {
        const infantry2: Unit = {
          id: `unit-${Date.now()}-${Math.random()}-2`,
          type: UnitType.INFANTRY,
          owner: currentPlayer,
          position: emptyPos,
          hp: 2,
          maxHp: 2,
          direction: chariot.direction,
          actionsThisTurn: 0, // 可以行动
          hasMoved: false,
          hasAttacked: false,
        };
        addUnit(infantry1);
        addUnit(infantry2);
      } else {
        // 没有空位，只生成1个步兵
        addUnit(infantry1);
      }

      consumeActionPoint(currentPlayer);
      return true;
    }

    if (newHp <= 0) {
      // 战车崩毁（血量≤0，被击杀崩毁），变为2个不可行动的满血步兵
      // 先将战车移动到目标位置（用于步兵生成位置）
      const movedChariot = { ...chariot, position: to };
      removeUnit(chariot.id);

      // 调用统一的崩毁处理函数（步兵不可行动）
      handleChariotDeath(movedChariot, false);
    } else {
      // 战车继续存在，更新位置和血量
      updateUnit(chariot.id, {
        position: to,
        hp: newHp,
        hasMoved: true,
        hasActedThisTurn: true,
        actionsThisTurn: chariot.actionsThisTurn + 1,
        killCount: ('killCount' in chariot ? (chariot as any).killCount : 0) + killedCount,
      } as any);
    }

    consumeActionPoint(currentPlayer);

    return true;
  };

  // 仁德：转化接触单位（一次性技能）
  const rendeConvertAdjacent = (general: Unit, target: Unit) => {
    if (currentActionPoints < 2) return false;
    if (general.type !== UnitType.GENERAL) return false;
    if (!('generalType' in general) || (general as any).generalType !== 'rende') return false;
    if ('abilityUsed' in general && (general as any).abilityUsed) return false;

    // 检查是否相邻（距离为1）
    if (hexDistance(general.position, target.position) !== 1) return false;

    // 如果是对敌将使用，需要检查上回合无击杀
    if (target.type === UnitType.GENERAL && target.owner !== general.owner) {
      const killedLastTurn = general.owner === Player.PLAYER1
        ? useGameStore.getState().player1KilledLastTurn
        : useGameStore.getState().player2KilledLastTurn;

      if (killedLastTurn) {
        // 上回合有击杀，不能对敌将使用
        alert(`仁德将军上回合有击杀，无法对敌方将军使用招降技能`);
        return false;
      }

      // 满足条件，直接获胜
      alert(`${general.owner === Player.PLAYER1 ? '玩家1' : '玩家2'} 使用仁德技能对敌将招降，直接获胜！`);
      setPhase('end' as any);
      return true;
    }

    // 转化为己方
    updateUnit(target.id, {
      owner: general.owner,
    });

    // 标记技能已使用
    updateUnit(general.id, {
      abilityUsed: true,
    } as any);

    // 消耗2点行动值
    consumeActionPoint(currentPlayer);
    consumeActionPoint(currentPlayer);

    return true;
  };

  // 仁德：转化中立标记为己方步兵（费用累进：1, 2, 4, 8...）
  const rendeConvertToInfantry = (general: Unit, neutralMarker: Unit) => {
    if (general.type !== UnitType.GENERAL) return false;
    if (!('generalType' in general) || (general as any).generalType !== 'rende') return false;
    if (neutralMarker.type !== UnitType.NEUTRAL_MARKER) return false;
    if (neutralMarker.owner !== Player.NEUTRAL) return false;

    // 检查是否相邻（距离为1）
    if (hexDistance(general.position, neutralMarker.position) !== 1) return false;

    // 获取当前转化费用（默认1点）
    const currentCost = (general as any).convertInfantryCost || 1;

    // 检查行动点是否足够
    if (currentActionPoints < currentCost) return false;

    // 消耗行动点
    for (let i = 0; i < currentCost; i++) {
      consumeActionPoint(currentPlayer);
    }

    // 将中立标记转化为己方步兵
    updateUnit(neutralMarker.id, {
      type: UnitType.INFANTRY,
      owner: general.owner,
      hp: 1,
      maxHp: 2,
    });

    // 更新将军的转化费用（翻倍）
    updateUnit(general.id, {
      convertInfantryCost: currentCost * 2,
    } as any);

    return true;
  };

  // 仁德：完成击杀（正常击杀目标）
  const rendeCompleteKill = (targetId: string) => {
    const target = units[targetId];
    if (!target) return false;

    // 移除目标单位
    removeUnit(targetId);
    recordKill(currentPlayer);

    // 如果是将军被击杀，永久减少骰子
    if (target.type === UnitType.GENERAL) {
      useGameStore.getState().removeDice(target.owner, 1);
    }

    // 弩车死亡：贯穿过3个及以上单位获得骰子奖励
    if (target.type === UnitType.BALLISTA && 'pierceCount' in target && (target as any).pierceCount >= 3) {
      useGameStore.getState().addDice(target.owner, 1);
    }

    return true;
  };

  // 仁德：转化为中立标记（替代击杀，消耗1点行动点）
  const rendeSpareAsNeutral = (attackerId: string, targetId: string) => {
    const attacker = units[attackerId];
    const target = units[targetId];
    if (!target || !attacker) return false;

    // 检查行动点是否足够
    if (currentActionPoints < 1) return false;

    // 消耗1点行动点
    consumeActionPoint(currentPlayer);

    // 计算目标占据的所有位置
    let occupiedPositions: HexCoord[] = [target.position];

    // 如果目标是机关单位，获取所有占据的位置
    if (target.type === UnitType.BALLISTA) {
      occupiedPositions = getMachineOccupiedHexes(target.position, 'ballista');
    } else if (target.type === UnitType.CHARIOT) {
      occupiedPositions = getMachineOccupiedHexes(target.position, 'chariot');
    }

    // 移除原目标单位
    removeUnit(targetId);

    // 在每个位置创建一个中立单位标记（血量1，体积1）
    occupiedPositions.forEach((pos, index) => {
      const markerId = `neutral_marker_${Date.now()}_${index}_${Math.random()}`;
      addUnit({
        id: markerId,
        type: UnitType.NEUTRAL_MARKER,
        owner: Player.NEUTRAL,
        position: pos,
        hp: 1,
        maxHp: 1,
        direction: Direction.EAST,
        actionsThisTurn: 0,
        hasMoved: false,
        hasAttacked: false,
      });
    });

    return true;
  };

  // 投石车蓄力
  const catapultCharge = (catapult: Unit) => {
    if (currentActionPoints < 1) return false;
    if (catapult.type !== UnitType.CATAPULT) return false;

    // 检查是否已行动
    if ('hasActedThisTurn' in catapult && catapult.hasActedThisTurn) return false;

    // 获取当前蓄力层数
    const currentCharge = ('chargeLevel' in catapult ? (catapult as any).chargeLevel : 0) || 0;

    // 检查是否已达蓄力上限
    if (currentCharge >= 2) return false;

    // 蓄力+1
    updateUnit(catapult.id, {
      chargeLevel: currentCharge + 1,
      hasActedThisTurn: true,
      actionsThisTurn: catapult.actionsThisTurn + 1,
    } as any);

    consumeActionPoint(currentPlayer);

    return true;
  };

  // 投石车攻击
  const catapultAttack = (catapult: Unit, target: Unit) => {
    if (currentActionPoints < 1) return false;
    if (catapult.type !== UnitType.CATAPULT) return false;

    // 检查是否已行动
    if ('hasActedThisTurn' in catapult && catapult.hasActedThisTurn) return false;

    // 检查目标是否在射程内（沿方向的直线）
    const validTargets = getValidAttacks(catapult);
    if (!validTargets.some(t => t.id === target.id)) return false;

    // 获取当前蓄力层数
    const chargeLevel = ('chargeLevel' in catapult ? (catapult as any).chargeLevel : 0) || 0;

    // 收集被攻击的所有单位
    const hitUnits: Unit[] = [target];

    if (chargeLevel >= 1) {
      // 蓄力1或2：溅射攻击
      // 计算目标身后的方向（远离投石车）
      const behindAxisLine = getAxisLineFromTarget(target.position, catapult.position, 5);

      if (chargeLevel === 1 && behindAxisLine.length > 0) {
        // 蓄力1：目标+身后1格
        const behindPos = behindAxisLine[0];
        const behindUnit = Object.values(units).find(u =>
          hexEquals(u.position, behindPos) && u.id !== target.id
        );
        if (behindUnit && !hitUnits.some(u => u.id === behindUnit.id)) {
          hitUnits.push(behindUnit);
        }
      } else if (chargeLevel === 2) {
        // 蓄力2：目标+身后120度扇形
        // 使用getFanShapedHexes获取扇形区域
        // 这里需要计算从target向远离catapult的方向
        const direction = catapult.direction;
        const fanHexes = getFanShapedHexes(target.position, direction, 1, 5);

        fanHexes.forEach(hexPos => {
          const unit = Object.values(units).find(u =>
            hexEquals(u.position, hexPos) && u.id !== target.id
          );
          if (unit && !hitUnits.some(u => u.id === unit.id)) {
            hitUnits.push(unit);
          }
        });
      }
    }

    // 对所有被击中的单位造成伤害
    hitUnits.forEach(hitUnit => {
      const newHp = hitUnit.hp - 1;

      if (newHp <= 0) {
        // 骑兵掉马
        if (hitUnit.type === UnitType.CAVALRY) {
          updateUnit(hitUnit.id, {
            type: UnitType.INFANTRY,
            hp: 1,
            maxHp: 2,
          });
        } else {
          removeUnit(hitUnit.id);
          if (hitUnit.owner !== catapult.owner) {
            recordKill(currentPlayer);
          }
          if (hitUnit.type === UnitType.GENERAL) {
            useGameStore.getState().removeDice(hitUnit.owner, 1);
          }
        }
      } else {
        updateUnit(hitUnit.id, {
          hp: newHp,
        });
      }
    });

    // 攻击后蓄力清零
    updateUnit(catapult.id, {
      hasAttacked: true,
      hasActedThisTurn: true,
      actionsThisTurn: catapult.actionsThisTurn + 1,
      chargeLevel: 0,
    } as any);

    consumeActionPoint(currentPlayer);

    return true;
  };

  // 投石车转向（消耗额外行动点）
  const catapultRotate = (catapult: Unit, direction: Direction) => {
    if (catapult.type !== UnitType.CATAPULT) return false;

    // 检查是否已行动
    if ('hasActedThisTurn' in catapult && catapult.hasActedThisTurn) return false;

    // 获取当前蓄力层数
    const chargeLevel = ('chargeLevel' in catapult ? (catapult as any).chargeLevel : 0) || 0;

    // 计算需要的行动点：基础1点 + 蓄力层数
    const requiredPoints = 1 + chargeLevel;

    if (currentActionPoints < requiredPoints) return false;

    updateUnit(catapult.id, {
      direction,
      hasActedThisTurn: true,
      actionsThisTurn: catapult.actionsThisTurn + 1,
    } as any);

    // 消耗对应的行动点
    for (let i = 0; i < requiredPoints; i++) {
      consumeActionPoint(currentPlayer);
    }

    return true;
  };

  // 投石车移动（消耗额外行动点）
  const catapultMove = (catapult: Unit, to: HexCoord) => {
    if (catapult.type !== UnitType.CATAPULT) return false;

    // 检查是否已行动
    if ('hasActedThisTurn' in catapult && catapult.hasActedThisTurn) return false;

    // 获取当前蓄力层数
    const chargeLevel = ('chargeLevel' in catapult ? (catapult as any).chargeLevel : 0) || 0;

    // 计算需要的行动点：基础1点 + 蓄力层数
    const requiredPoints = 1 + chargeLevel;

    if (currentActionPoints < requiredPoints) return false;

    // 检查目标位置是否合法
    const validMoves = getValidMoves(catapult);
    if (!validMoves.some(hex => hexEquals(hex, to))) return false;

    updateUnit(catapult.id, {
      position: to,
      hasMoved: true,
      hasActedThisTurn: true,
      actionsThisTurn: catapult.actionsThisTurn + 1,
    } as any);

    // 消耗对应的行动点
    for (let i = 0; i < requiredPoints; i++) {
      consumeActionPoint(currentPlayer);
    }

    return true;
  };

  return {
    selectedUnit,
    currentActionPoints,
    getValidMoves,
    getValidAttacks,
    moveUnit,
    attackUnit,
    rotateUnit,
    deployUnit,
    deployMachine,
    ballistaAttack,
    ballistaMeleeAttack,
    chariotMove,
    catapultCharge,
    catapultAttack,
    catapultRotate,
    catapultMove,
    rendeConvertAdjacent,
    rendeConvertToInfantry,
    rendeCompleteKill,
    rendeSpareAsNeutral,
  };
};
