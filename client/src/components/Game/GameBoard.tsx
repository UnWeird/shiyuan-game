import React, { useState, useMemo, useEffect } from 'react';
import { UnitType, Direction, GamePhase, Player } from '../../types';
import type { Unit, HexCoord } from '../../types';
import { useGameStore } from '../../stores/gameStore';
import { useGameActions } from '../../hooks/useGameActions';
import { HexMap } from '../Map/HexMap';
import { UnitPiece } from '../Unit/UnitPiece';
import { BattleLog } from '../UI/BattleLog';
import { hexEquals, hexToPixel, generateHexMap, isInStartZone, getShootingPath, getFanShapedHexes, getMachineOccupiedHexes, getBallistaVerticalPath, hexDistance, hexNeighbors } from '../../utils/hexUtils';
import { colyseusService } from '../../services/ColyseusService';

interface BattleLogEntry {
  id: string;
  message: string;
  type: 'move' | 'attack' | 'deploy' | 'kill' | 'info' | 'ability';
  timestamp: number;
}

export const GameBoard: React.FC = () => {
  const {
    phase,
    currentPlayer,
    units,
    selectedUnitId,
    selectUnit,
    player1ActionPoints,
    player2ActionPoints,
    player1TempMaxActionPoints,
    player2TempMaxActionPoints,
    player1DiceResults,
    player2DiceResults,
    player1KillDice,
    player2KillDice,
    player1LostDice,
    player2LostDice,
    player1Dice,
    player2Dice,
    player1General,
    player2General,
    player1Army,
    player2Army,
    player1Base,
    player2Base,
    player1RerollTokens,
    player2RerollTokens,
    player1DeployedValue,
    player2DeployedValue,
    rollDice,
    endTurn,
    modifyDiceResult,
    rerollDice,
    updateUnit,
    removeUnit,
    consumeActionPoint,
    addActionPoints,
    setTempMaxActionPoints,
    isOnlineMode,
    myPlayerRole,
    // 扇形攻击状态（在线模式使用服务器同步的状态）
    wushuangFanAttackActive: storeWushuangFanAttackActive,
    wushuangAttackingPlayer: storeWushuangAttackingPlayer,
    wushuangAttackPhase: storeWushuangAttackPhase,
    wushuangSelectedDirection: storeWushuangSelectedDirection,
    wushuangDiceRolls: storeWushuangDiceRolls,
  } = useGameStore();

  const {
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
    rendeConvertAdjacent,
    rendeConvertToInfantry,
    rendeCompleteKill,
    rendeSpareAsNeutral,
  } = useGameActions();

  const [highlightedHexes, setHighlightedHexes] = useState<HexCoord[]>([]);
  const [actionMode, setActionMode] = useState<'move' | 'attack' | 'deploy' | 'rotate' | 'rende-convert' | 'rende-neutral' | null>(null);
  const [deployUnitType, setDeployUnitType] = useState<UnitType | null>(null);
  const [battleLogs, setBattleLogs] = useState<BattleLogEntry[]>([]);
  const [rotationPaths, setRotationPaths] = useState<Map<Direction, HexCoord[]>>(new Map());
  const [shenjiAbilityActive, setShenjiAbilityActive] = useState(false);
  const [selectedDiceIndex, setSelectedDiceIndex] = useState<number | null>(null);
  const [rerollMode, setRerollMode] = useState(false);
  // 扇形攻击本地状态（单机模式使用）
  const [localWushuangFanAttackActive, setLocalWushuangFanAttackActive] = useState(false);
  const [localWushuangSelectedDirection, setLocalWushuangSelectedDirection] = useState<Direction | null>(null);
  const [localWushuangAttackPhase, setLocalWushuangAttackPhase] = useState<'select-direction' | 'second-roll' | 'second-attack' | 'third-roll' | 'third-attack'>('select-direction');
  const [localWushuangDiceRolls, setLocalWushuangDiceRolls] = useState<number[]>([]);

  // 在线模式使用服务器同步的状态，单机模式使用本地状态
  const wushuangFanAttackActive = isOnlineMode ? storeWushuangFanAttackActive : localWushuangFanAttackActive;
  const wushuangSelectedDirection = isOnlineMode ? (storeWushuangSelectedDirection !== null ? storeWushuangSelectedDirection : null) : localWushuangSelectedDirection;
  const wushuangAttackPhase = isOnlineMode ? storeWushuangAttackPhase : localWushuangAttackPhase;
  const wushuangDiceRolls = isOnlineMode ? storeWushuangDiceRolls : localWushuangDiceRolls;

  // 状态setter包装函数（单机模式使用本地setter，在线模式不需要setter因为由服务器控制）
  const setWushuangFanAttackActive = (value: boolean) => {
    if (!isOnlineMode) setLocalWushuangFanAttackActive(value);
  };
  const setWushuangSelectedDirection = (value: Direction | null) => {
    if (!isOnlineMode) setLocalWushuangSelectedDirection(value);
  };
  const setWushuangAttackPhase = (value: 'select-direction' | 'second-roll' | 'second-attack' | 'third-roll' | 'third-attack') => {
    if (!isOnlineMode) setLocalWushuangAttackPhase(value);
  };
  const setWushuangDiceRolls = (value: number[]) => {
    if (!isOnlineMode) setLocalWushuangDiceRolls(value);
  };

  const [wushuangTargets, setWushuangTargets] = useState<string[]>([]);
  const [rendeKillConfirm, setRendeKillConfirm] = useState<{ attacker: Unit; target: Unit } | null>(null);

  // 在线模式：监听仁德击杀确认事件
  useEffect(() => {
    if (!isOnlineMode) return;

    const handleRendeKillConfirm = (event: Event) => {
      const customEvent = event as CustomEvent<{ attacker: Unit; target: Unit }>;
      setRendeKillConfirm(customEvent.detail);
    };

    window.addEventListener('rendeKillConfirm', handleRendeKillConfirm);

    return () => {
      window.removeEventListener('rendeKillConfirm', handleRendeKillConfirm);
    };
  }, [isOnlineMode]);

  // 判断是否是自己的回合
  const isMyTurn = !isOnlineMode ||
    (myPlayerRole === 'player1' && currentPlayer === Player.PLAYER1) ||
    (myPlayerRole === 'player2' && currentPlayer === Player.PLAYER2);

  // 添加战斗日志
  const addLog = (message: string, type: BattleLogEntry['type']) => {
    setBattleLogs(prev => [...prev, {
      id: `${Date.now()}-${Math.random()}`,
      message,
      type,
      timestamp: Date.now(),
    }]);
  };

  // 消耗行动点但不触发自动回合切换（用于扇形攻击）
  const consumeActionPointNoAutoSwitch = (player: Player, count: number = 1) => {
    for (let i = 0; i < count; i++) {
      if (player === Player.PLAYER1) {
        useGameStore.setState(state => ({
          player1ActionPoints: Math.max(0, state.player1ActionPoints - 1)
        }));
      } else if (player === Player.PLAYER2) {
        useGameStore.setState(state => ({
          player2ActionPoints: Math.max(0, state.player2ActionPoints - 1)
        }));
      }
    }
  };

  // 计算已部署的单位数量
  const deployedCounts = useMemo(() => {
    const myUnits = Object.values(units).filter(u => u.owner === currentPlayer);
    return {
      infantry: myUnits.filter(u => u.type === UnitType.INFANTRY).length,
      cavalry: myUnits.filter(u => u.type === UnitType.CAVALRY).length,
      archer: myUnits.filter(u => u.type === UnitType.ARCHER).length,
      general: myUnits.filter(u => u.type === UnitType.GENERAL).length,
    };
  }, [units, currentPlayer]);

  // 获取当前玩家的配置
  const army = currentPlayer === Player.PLAYER1 ? player1Army : player2Army;

  // 开始部署阶段时掷骰子
  const handleRollDice = () => {
    if (isOnlineMode) {
      // 在线模式：发送给服务器
      colyseusService.rollDice();
    } else {
      // 单机模式：本地处理
      rollDice(currentPlayer);
    }
  };

  // 选中单位
  const handleUnitClick = (unitId: string) => {
    const unit = units[unitId];
    // 在线模式下只能选择自己的单位
    if (isOnlineMode && myPlayerRole) {
      const myPlayer = myPlayerRole === 'player1' ? Player.PLAYER1 : Player.PLAYER2;
      if (unit.owner !== myPlayer) return;
    } else {
      if (unit.owner !== currentPlayer) return;
    }

    selectUnit(unitId);
    setActionMode(null);

    // 如果是机关单位，高亮其所有占用的格子
    if (unit.type === UnitType.BALLISTA || unit.type === UnitType.CHARIOT) {
      const machineTypeStr = unit.type === UnitType.BALLISTA ? 'ballista' : 'chariot';
      const occupiedHexes = getMachineOccupiedHexes(unit.position, machineTypeStr);
      // 排除中心位置，只高亮额外占用的格子
      setHighlightedHexes(occupiedHexes.slice(1));
    } else {
      setHighlightedHexes([]);
    }
  };

  // 点击地图
  const handleHexClick = (hex: HexCoord) => {
    // 在线模式下的部署处理
    if (isOnlineMode && actionMode === 'deploy' && deployUnitType) {
      // 检查是否是机关单位
      if (deployUnitType === UnitType.BALLISTA || deployUnitType === UnitType.CHARIOT) {
        // 在线模式：发送部署机关单位命令到服务器
        const machineType = deployUnitType === UnitType.BALLISTA ? 'ballista' : 'chariot';
        colyseusService.shenjiDeployMachine(machineType as 'ballista' | 'chariot', hex);

        const unitName = deployUnitType === UnitType.BALLISTA ? '弩车' : '战车';
        addLog(`部署了${unitName}`, 'deploy');

        // 部署成功后退出部署模式
        setActionMode(null);
        setDeployUnitType(null);
        setHighlightedHexes([]);
        return;
      }

      // 普通单位部署
      colyseusService.deployUnit({
        unitType: deployUnitType,
        position: hex,
        direction: 0,
      });

      // 部署成功后的UI反馈
      const unitName = deployUnitType === UnitType.INFANTRY ? '步兵' :
                      deployUnitType === UnitType.CAVALRY ? '骑兵' :
                      deployUnitType === UnitType.ARCHER ? '弓箭手' : '将军';
      addLog(`部署了${unitName}`, 'deploy');
      return;
    }

    // 单机模式的原有逻辑
    if (actionMode === 'deploy' && deployUnitType) {
      // 机关单位使用特殊部署逻辑
      if (deployUnitType === UnitType.BALLISTA || deployUnitType === UnitType.CHARIOT) {
        if (deployMachine(deployUnitType, hex)) {
          const unitName = deployUnitType === UnitType.BALLISTA ? '弩车' : '战车';
          addLog(`部署了${unitName}`, 'deploy');
          // 保持部署模式，允许连续部署同类型单位
          // setActionMode(null);
          // setDeployUnitType(null);
          // setHighlightedHexes([]);
        }
      } else {
        // 普通单位部署
        if (deployUnit(deployUnitType, hex)) {
          const unitName = deployUnitType === UnitType.INFANTRY ? '步兵' :
                          deployUnitType === UnitType.CAVALRY ? '骑兵' :
                          deployUnitType === UnitType.ARCHER ? '弓箭手' : '将军';
          addLog(`部署了${unitName}`, 'deploy');
          // 保持部署模式，允许连续部署同类型单位
          // setActionMode(null);
          // setDeployUnitType(null);
          // setHighlightedHexes([]);
        }
      }
      return;
    }

    if (actionMode === 'rotate') {
      // 点击射击路径选择方向
      handleRotationPathClick(hex);
      return;
    }

    // 仁德技能：转化接触单位
    if (actionMode === 'rende-convert' && selectedUnit) {
      const target = Object.values(units).find(u => {
        // 检查是否是机关单位
        if (u.type === UnitType.BALLISTA || u.type === UnitType.CHARIOT) {
          const machineType = u.type === UnitType.BALLISTA ? 'ballista' : 'chariot';
          const occupiedHexes = getMachineOccupiedHexes(u.position, machineType);
          return occupiedHexes.some(occupiedHex => hexEquals(occupiedHex, hex));
        }
        return hexEquals(u.position, hex);
      });
      if (target && target.id !== selectedUnit.id) {
        if (isOnlineMode) {
          // 在线模式：发送转化接触单位请求到服务器
          colyseusService.rendeConvertAdjacent();
          addLog(`仁德技能：转化接触单位`, 'ability');
          setActionMode(null);
          setHighlightedHexes([]);
        } else {
          // 单机模式：本地处理
          if (rendeConvertAdjacent(selectedUnit, target)) {
            if (target.type === UnitType.GENERAL && target.owner !== selectedUnit.owner) {
              addLog(`仁德技能：对敌将使用，直接获胜！`, 'ability');
            } else {
              addLog(`仁德技能：转化了单位`, 'ability');
            }
            setActionMode(null);
            setHighlightedHexes([]);
          }
        }
      }
      return;
    }

    // 仁德技能：转化中立标记为步兵
    if (actionMode === 'rende-neutral' && selectedUnit) {
      const target = Object.values(units).find(u => {
        // 只能转化中立单位标记
        if (u.type !== UnitType.NEUTRAL_MARKER) return false;
        if (u.owner !== Player.NEUTRAL) return false;
        return hexEquals(u.position, hex);
      });
      if (target && target.type === UnitType.NEUTRAL_MARKER) {
        if (isOnlineMode) {
          // 在线模式：发送转化为步兵请求到服务器
          colyseusService.rendeConvertToInfantry(target.id);
          const cost = (selectedUnit as any).convertInfantryCost || 1;
          addLog(`转化中立标记为步兵（消耗${cost}点）`, 'ability');
          setActionMode(null);
          setHighlightedHexes([]);
        } else {
          // 单机模式：本地处理
          if (rendeConvertToInfantry(selectedUnit, target)) {
            const cost = (selectedUnit as any).convertInfantryCost || 1;
            addLog(`转化中立标记为步兵（消耗${cost / 2}点）`, 'ability');
            setActionMode(null);
            setHighlightedHexes([]);
          }
        }
      }
      return;
    }

    // 如果没有选中单位且不在特殊模式，点击格子可能是要选择机关单位
    if (!selectedUnit && !actionMode) {
      const unit = Object.values(units).find(u => {
        if (u.owner !== currentPlayer) return false;
        // 检查是否是机关单位
        if (u.type === UnitType.BALLISTA || u.type === UnitType.CHARIOT) {
          const machineType = u.type === UnitType.BALLISTA ? 'ballista' : 'chariot';
          const occupiedHexes = getMachineOccupiedHexes(u.position, machineType);
          return occupiedHexes.some(occupiedHex => hexEquals(occupiedHex, hex));
        }
        return hexEquals(u.position, hex);
      });
      if (unit) {
        handleUnitClick(unit.id);
        return;
      }
    }

    if (!selectedUnit) return;

    if (actionMode === 'move') {
      // 战车使用特殊移动逻辑
      if (selectedUnit.type === UnitType.CHARIOT) {
        if (isOnlineMode) {
          // 在线模式：发送移动指令到服务器（战车也使用moveUnit）
          colyseusService.moveUnit(selectedUnit.id, hex);
          addLog(`战车碾压移动`, 'move');
          setActionMode(null);
          setHighlightedHexes([]);
          selectUnit(null);
        } else {
          // 单机模式：使用本地战车移动逻辑
          if (chariotMove(selectedUnit, hex)) {
            addLog(`战车碾压移动`, 'move');
            setActionMode(null);
            setHighlightedHexes([]);
            selectUnit(null);
          }
        }
      } else {
        // 普通移动
        if (isOnlineMode) {
          // 在线模式：发送移动指令到服务器
          colyseusService.moveUnit(selectedUnit.id, hex);
          addLog(`${selectedUnit.type}移动`, 'move');
          setActionMode(null);
          setHighlightedHexes([]);
          selectUnit(null);
        } else {
          // 单机模式：本地处理
          if (moveUnit(selectedUnit, hex)) {
            addLog(`${selectedUnit.type}移动`, 'move');
            setActionMode(null);
            setHighlightedHexes([]);
            selectUnit(null);
          }
        }
      }
    } else if (actionMode === 'attack') {
      // 弩车：根据点击位置判断使用贯穿攻击还是近战攻击
      if (selectedUnit.type === UnitType.BALLISTA) {
        // 检查点击位置是否与弩车的任意占用格子相邻（近战范围）
        const ballistaOccupiedHexes = getMachineOccupiedHexes(selectedUnit.position, 'ballista');
        const isAdjacentToClick = ballistaOccupiedHexes.some(ballistaHex =>
          hexDistance(ballistaHex, hex) === 1
        );

        if (isAdjacentToClick) {
          // 近战攻击：查找相邻位置的敌方单位
          const target = Object.values(units).find(u => {
            if (u.owner === selectedUnit.owner || u.id === selectedUnit.id) return false;

            // 检查是否是机关单位
            if (u.type === UnitType.BALLISTA || u.type === UnitType.CHARIOT) {
              const machineType = u.type === UnitType.BALLISTA ? 'ballista' : 'chariot';
              const occupiedHexes = getMachineOccupiedHexes(u.position, machineType);
              return occupiedHexes.some(occupiedHex => hexEquals(occupiedHex, hex));
            }
            // 普通单位只检查中心位置
            return hexEquals(u.position, hex);
          });

          if (target) {
            if (isOnlineMode) {
              // 在线模式：发送近战攻击指令到服务器
              colyseusService.ballistaMeleeAttack(selectedUnit.id, target.id);
              addLog(`弩车近战攻击`, 'attack');
            } else {
              // 单机模式：本地处理
              if (ballistaMeleeAttack(selectedUnit, target)) {
                addLog(`弩车近战攻击`, 'attack');
              }
            }
            setActionMode(null);
            setHighlightedHexes([]);
            selectUnit(null);
          }
        } else {
          // 贯穿攻击
          if (isOnlineMode) {
            // 在线模式：发送贯穿攻击指令到服务器
            colyseusService.ballistaPierceAttack(selectedUnit.id);
            addLog(`弩车贯穿攻击`, 'attack');
            setActionMode(null);
            setHighlightedHexes([]);
            selectUnit(null);
          } else {
            // 单机模式：本地处理
            if (ballistaAttack(selectedUnit)) {
              addLog(`弩车贯穿攻击`, 'attack');
              setActionMode(null);
              setHighlightedHexes([]);
              selectUnit(null);
            }
          }
        }
      } else {
        // 普通攻击 - 查找被点击位置的单位（包括机关占用的格子）
        const target = Object.values(units).find(u => {
          // 检查是否是机关单位
          if (u.type === UnitType.BALLISTA || u.type === UnitType.CHARIOT) {
            const machineType = u.type === UnitType.BALLISTA ? 'ballista' : 'chariot';
            const occupiedHexes = getMachineOccupiedHexes(u.position, machineType);
            return occupiedHexes.some(occupiedHex => hexEquals(occupiedHex, hex));
          }
          // 普通单位只检查中心位置
          return hexEquals(u.position, hex);
        });

        if (target) {
          if (isOnlineMode) {
            // 在线模式：发送攻击指令到服务器
            // 注意：仁德将军的特殊逻辑目前不支持在线模式
            colyseusService.attackUnit(selectedUnit.id, target.id);
            // 暂时显示攻击日志（实际结果由服务器决定）
            addLog(`${selectedUnit.type}攻击${target.type}`, 'attack');
            setActionMode(null);
            setHighlightedHexes([]);
            selectUnit(null);
          } else {
            // 单机模式：本地处理
            const result = attackUnit(selectedUnit, target);

            // 检查是否是仁德击杀需要确认
            if (result === 'rende_kill_confirm') {
              // 显示确认对话框
              setRendeKillConfirm({ attacker: selectedUnit, target });
              setActionMode(null);
              setHighlightedHexes([]);
              return;
            }

            if (result) {
              const targetNewHp = target.hp - 1;
              if (targetNewHp <= 0) {
                addLog(`${selectedUnit.type}击杀了${target.type}！`, 'kill');
              } else {
                addLog(`${selectedUnit.type}攻击${target.type}`, 'attack');
              }
              setActionMode(null);
              setHighlightedHexes([]);
              selectUnit(null);
            }
          }
        }
      }
    }
  };

  // 显示移动范围
  const handleShowMoves = () => {
    if (!selectedUnit) return;
    const moves = getValidMoves(selectedUnit);
    setHighlightedHexes(moves);
    setActionMode('move');
  };

  // 显示攻击范围
  const handleShowAttacks = () => {
    if (!selectedUnit) return;

    // 弩车：显示贯穿射击路径 + 近战范围
    if (selectedUnit.type === UnitType.BALLISTA) {
      const isPlayerOne = selectedUnit.owner === Player.PLAYER1;
      const shootingPath = getBallistaVerticalPath(selectedUnit.position, isPlayerOne, 5);

      // 近战范围：相邻的所有格子
      const meleeRange = hexNeighbors(selectedUnit.position);

      // 合并显示贯穿路径和近战范围
      setHighlightedHexes([...shootingPath, ...meleeRange]);
      setActionMode('attack');
      return;
    }

    const targets = getValidAttacks(selectedUnit);
    // 只高亮敌人的位置,不是整个范围
    setHighlightedHexes(targets.map(t => t.position));
    setActionMode('attack');
  };

  // 开始部署模式
  const handleStartDeploy = (unitType: UnitType) => {
    setDeployUnitType(unitType);
    setActionMode('deploy');

    // 计算可部署区域
    const allHexes = generateHexMap(5);
    // 在线模式下根据myPlayerRole确定区域，单机模式根据currentPlayer确定
    const playerSide = (isOnlineMode && myPlayerRole)
      ? (myPlayerRole === 'player1' ? 'top' : 'bottom')
      : (currentPlayer === Player.PLAYER1 ? 'top' : 'bottom');

    const availableHexes = allHexes.filter(hex => {
      const inStartZone = isInStartZone(hex, playerSide);
      const occupied = Object.values(units).some(u => hexEquals(u.position, hex));

      // 机关单位（弩车和战车）只能部署在中间排
      if (unitType === UnitType.BALLISTA || unitType === UnitType.CHARIOT) {
        const middleRow = playerSide === 'top' ? 4 : -4;
        return inStartZone && !occupied && hex.r === middleRow;
      }

      // 普通单位可以部署在整个起始区
      return inStartZone && !occupied;
    });

    setHighlightedHexes(availableHexes);
    selectUnit(null);
  };

  // 取消部署
  const handleCancelDeploy = () => {
    setDeployUnitType(null);
    setActionMode(null);
    setHighlightedHexes([]);
  };

  // 进入转向模式 - 显示所有射击路径
  const handleShowRotation = () => {
    if (!selectedUnit) return;
    if (selectedUnit.type !== UnitType.ARCHER && selectedUnit.type !== UnitType.BALLISTA) return;

    // 计算所有6个方向的射击路径
    const paths = new Map<Direction, HexCoord[]>();
    // 只被敌方单位阻挡，友方单位不阻挡
    const enemyPositions = Object.values(units)
      .filter(u => u.owner !== selectedUnit.owner && u.id !== selectedUnit.id)
      .map(u => u.position);

    [
      Direction.EAST,
      Direction.NORTH_EAST,
      Direction.NORTH_WEST,
      Direction.WEST,
      Direction.SOUTH_WEST,
      Direction.SOUTH_EAST,
    ].forEach(dir => {
      const path = getShootingPath(selectedUnit.position, dir, 5, enemyPositions);
      paths.set(dir, path);
    });

    setRotationPaths(paths);
    setActionMode('rotate');

    // 高亮所有路径
    const allPathHexes: HexCoord[] = [];
    paths.forEach(path => allPathHexes.push(...path));
    setHighlightedHexes(allPathHexes);
  };

  // 转向
  const handleRotate = (direction: Direction) => {
    if (!selectedUnit) return;
    if (isOnlineMode) {
      // 在线模式：发送旋转指令到服务器
      colyseusService.rotateUnit(selectedUnit.id, direction);
      addLog(`${selectedUnit.type}转向`, 'info');
      setActionMode(null);
      setHighlightedHexes([]);
      setRotationPaths(new Map());
    } else {
      // 单机模式：本地处理
      if (rotateUnit(selectedUnit, direction)) {
        addLog(`${selectedUnit.type}转向`, 'info');
        setActionMode(null);
        setHighlightedHexes([]);
        setRotationPaths(new Map());
      }
    }
  };

  // 点击射击路径上的hex来选择方向
  const handleRotationPathClick = (hex: HexCoord) => {
    if (actionMode !== 'rotate' || !selectedUnit) return;

    // 找到这个hex属于哪个方向的路径
    for (const [dir, path] of rotationPaths.entries()) {
      if (path.some(h => hexEquals(h, hex))) {
        handleRotate(dir);
        return;
      }
    }
  };

  // 结束回合
  const handleEndTurn = () => {
    if (isOnlineMode) {
      // 在线模式：发送给服务器
      // TODO: 部署阶段结束部署 or 战斗回合结束
      if (phase === GamePhase.DEPLOY) {
        colyseusService.finishDeploy();
      } else {
        colyseusService.endTurn();
      }
    } else {
      // 单机模式：本地处理
      endTurn();
    }

    setActionMode(null);
    setHighlightedHexes([]);
    selectUnit(null);

    // 重置无双扇形攻击状态
    setWushuangFanAttackActive(false);
    setWushuangTargets([]);
    setWushuangDiceRolls([]);
    setWushuangSelectedDirection(null);
    setWushuangAttackPhase('select-direction');
  };

  // 神机技能：修改骰子点数
  const handleShenjiAbility = () => {
    setShenjiAbilityActive(true);
    addLog('神机技能：选择要修改的骰子', 'info');
  };

  const handleDiceClick = (diceIndex: number, player: Player) => {
    if (shenjiAbilityActive) {
      setSelectedDiceIndex(diceIndex);
      return;
    }

    if (rerollMode) {
      // 重投模式：直接重投该骰子
      rerollDice(player, diceIndex);
      addLog(`重投骰子 #${diceIndex + 1}`, 'info');
      setRerollMode(false);
      return;
    }
  };

  const handleModifyDice = (newValue: number) => {
    if (selectedDiceIndex === null) return;

    if (isOnlineMode) {
      // 在线模式：发送改骰请求到服务器
      colyseusService.shenjiModifyDice(selectedDiceIndex, newValue);
      addLog(`神机将军修改骰子点数为${newValue}`, 'info');
      setShenjiAbilityActive(false);
      setSelectedDiceIndex(null);
      return;
    }

    // 单机模式的原有逻辑
    // 找到将军单位并标记技能已使用
    const general = Object.values(units).find(u =>
      u.owner === currentPlayer &&
      u.type === UnitType.GENERAL
    );

    if (general) {
      updateUnit(general.id, { abilityUsed: true } as any);
      modifyDiceResult(currentPlayer, selectedDiceIndex, newValue);
      addLog(`神机将军修改骰子点数为${newValue}`, 'info');
      setShenjiAbilityActive(false);
      setSelectedDiceIndex(null);
    }
  };

  const cancelShenjiAbility = () => {
    setShenjiAbilityActive(false);
    setSelectedDiceIndex(null);
    addLog('取消神机技能', 'info');
  };

  // 无双技能：立刻获得当前已损失体力值数量的行动次数
  const handleWushuangInvincibility = () => {
    if (isOnlineMode) {
      // 在线模式：发送技能请求
      colyseusService.wushuangAbility();
      return;
    }

    // 单机模式的原有逻辑
    const general = Object.values(units).find(u =>
      u.owner === currentPlayer &&
      u.type === UnitType.GENERAL
    );

    if (general && 'abilityUsed' in general && !general.abilityUsed) {
      // 计算已损失的体力值
      const lostHp = general.maxHp - general.hp;

      // 增加行动次数上限 = 2 + 已损失血量，并设置无限行动标志
      updateUnit(general.id, {
        bonusActionLimit: lostHp,
        unlimitedActions: true,
        abilityUsed: true,
      } as any);

      const newLimit = 2 + lostHp;
      if (lostHp > 0) {
        addLog(`无双技能：行动次数上限增加${lostHp}次（2 → ${newLimit}），已损失${lostHp}点体力`, 'info');
        addLog('本回合移动和扇形攻击次数限制解除！', 'info');
      } else {
        addLog('无双技能：当前满血，行动次数上限不变（仍为2次）', 'info');
        addLog('本回合移动和扇形攻击次数限制解除！', 'info');
      }
    }
  };

  // 无双技能：扇形范围攻击 - 第一步：消耗3点行动值发动
  const handleWushuangFanAttack = () => {
    if (isOnlineMode) {
      // 在线模式：发送开始扇形攻击请求
      colyseusService.wushuangFanAttackStart();
      addLog('无双扇形攻击：请选择攻击方向', 'info');
      return;
    }

    // 单机模式的原有逻辑
    const general = Object.values(units).find(u =>
      u.owner === currentPlayer &&
      u.type === UnitType.GENERAL
    );

    if (!general) return;

    // 计算行动次数上限
    const bonusActions = ('bonusActionLimit' in general && typeof general.bonusActionLimit === 'number') ? general.bonusActionLimit : 0;
    const actionLimit = 2 + bonusActions;

    // 检查是否已达到行动次数上限
    if (general.actionsThisTurn >= actionLimit) {
      addLog('已达到本回合行动次数上限', 'info');
      return;
    }

    // 检查是否有无限行动标志（无双技能）
    const hasUnlimitedActions = 'unlimitedActions' in general && general.unlimitedActions;

    // 如果没有无限行动且没有额外行动次数，按照原来的规则：攻击过（用过扇形攻击）就不能再攻击
    if (!hasUnlimitedActions && bonusActions === 0 && 'hasFanAttacked' in general && general.hasFanAttacked) {
      addLog('本回合已使用过扇形攻击', 'info');
      return;
    }

    // 检查是否有足够的行动点（需要3点）
    if (currentActionPoints < 3) {
      addLog('行动点不足（需要3点）', 'info');
      return;
    }

    setLocalWushuangFanAttackActive(true);
    addLog('无双扇形攻击：请选择攻击方向', 'info');
  };

  // 无双技能：选择方向
  const handleWushuangSelectDirection = (direction: Direction) => {
    // 找到将军单位（在线和单机模式都需要用来计算高亮范围）
    const general = Object.values(units).find(u =>
      u.owner === currentPlayer &&
      u.type === UnitType.GENERAL
    );

    if (!general) return;

    // 设置选中的方向并高亮攻击范围（在线和单机模式都需要）
    if (!isOnlineMode) {
      setLocalWushuangSelectedDirection(direction);
    }

    // 获取该方向的扇形区域（扇形攻击固定覆盖3个单位，范围5）
    const fanHexes = getFanShapedHexes(general.position, direction, 3, 5);
    setHighlightedHexes(fanHexes);

    // 计算扇形区域内的敌方单位数量
    const enemyUnitsInFan = Object.values(units).filter(u =>
      u.owner !== currentPlayer &&
      fanHexes.some(hex => hexEquals(hex, u.position))
    );

    addLog(`${getDirectionName(direction)}方向有${enemyUnitsInFan.length}个敌方单位`, 'info');

    // 在线模式：发送选择方向请求
    if (isOnlineMode) {
      colyseusService.wushuangSelectDirection(direction);
    }
  };

  // 获取方向名称
  const getDirectionName = (dir: Direction): string => {
    const names: Record<Direction, string> = {
      [Direction.EAST]: '东',
      [Direction.NORTH_EAST]: '东北',
      [Direction.NORTH_WEST]: '西北',
      [Direction.WEST]: '西',
      [Direction.SOUTH_WEST]: '西南',
      [Direction.SOUTH_EAST]: '东南',
      [Direction.NORTH]: '北',
      [Direction.SOUTH]: '南',
    };
    return names[dir];
  };

  // 执行无双扇形攻击
  const executeWushuangFanAttack = () => {
    if (isOnlineMode) {
      // 在线模式：发送执行攻击请求（服务器会根据当前阶段执行相应的攻击）
      colyseusService.wushuangExecuteAttack();
      return;
    }

    // 单机模式的原有逻辑
    if (wushuangSelectedDirection === null) {
      addLog('请先选择攻击方向', 'info');
      return;
    }

    const general = Object.values(units).find(u =>
      u.owner === currentPlayer &&
      u.type === UnitType.GENERAL
    );

    if (!general) return;

    // 执行当前这一轮的扇形攻击
    const performFanAttack = () => {
      // 获取扇形区域内的敌方单位（120度扇形，覆盖3个单位）
      const fanHexes = getFanShapedHexes(general.position, wushuangSelectedDirection!, 3, 5);
      const enemyUnitsInFan = Object.values(units).filter(u =>
        u.owner !== currentPlayer &&
        fanHexes.some(hex => hexEquals(hex, u.position))
      );

      if (enemyUnitsInFan.length === 0) {
        addLog('该方向没有敌方单位', 'info');
        return false;
      }

      // 对扇形区域内的所有敌方单位造成伤害
      enemyUnitsInFan.forEach(target => {
        const targetUnit = units[target.id];
        if (!targetUnit) return;

        const newHp = targetUnit.hp - 1;
        if (newHp <= 0) {
          removeUnit(targetUnit.id);
          useGameStore.getState().recordKill(currentPlayer);
          if (targetUnit.type === UnitType.GENERAL) {
            useGameStore.getState().removeDice(targetUnit.owner, 1);
          }
          addLog(`无双扇形攻击击杀了${targetUnit.type}！`, 'kill');
        } else {
          updateUnit(targetUnit.id, {
            hp: newHp,
            isFlipped: true,
          });
          addLog(`无双扇形攻击命中${targetUnit.type}`, 'attack');
        }
      });

      return true;
    };

    // 根据攻击阶段执行不同逻辑
    if (wushuangAttackPhase === 'select-direction') {
      // 第一次攻击：消耗3点行动值（不触发自动回合切换）
      consumeActionPointNoAutoSwitch(currentPlayer, 3);
      performFanAttack();

      // 标记已使用扇形攻击 + 增加行动次数
      updateUnit(general.id, {
        hasFanAttacked: true,
        actionsThisTurn: general.actionsThisTurn + 1,
      } as any);

      // 进入第二阶段：询问是否消耗2点行动值继续
      setWushuangAttackPhase('second-roll');
      addLog('第一次攻击完成，是否消耗2点行动值继续掷骰？', 'info');
    }
  };

  // 第二阶段：消耗2点行动值掷骰子，若≤2则再攻击一次
  const executeWushuangSecondRoll = () => {
    if (isOnlineMode) {
      // 在线模式：发送第二阶段掷骰请求
      colyseusService.wushuangSecondRoll();
      return;
    }

    // 单机模式的原有逻辑
    const general = Object.values(units).find(u =>
      u.owner === currentPlayer &&
      u.type === UnitType.GENERAL
    );

    if (!general) return;

    // 检查行动值是否足够
    if (currentActionPoints < 2) {
      addLog('行动值不足，自动进入第三阶段', 'info');
      setWushuangAttackPhase('third-roll');
      setWushuangSelectedDirection(null); // 重置方向选择
      return;
    }

    // 消耗2点行动值（不触发自动回合切换）
    consumeActionPointNoAutoSwitch(currentPlayer, 2);
    addLog('消耗2点行动值掷骰', 'info');

    // 掷骰子
    const roll = Math.floor(Math.random() * 6) + 1;
    addLog(`第二阶段掷骰结果：${roll}`, 'info');
    setWushuangDiceRolls([roll]);

    if (roll <= 2) {
      addLog(`掷出${roll}！可以进行第二次攻击，请选择方向`, 'info');
      // 重置方向选择，让玩家重新选择攻击方向
      setWushuangSelectedDirection(null);
      setWushuangAttackPhase('second-attack');
    } else {
      addLog(`掷出${roll}，第二次攻击未触发`, 'info');
      // 进入第三阶段
      setWushuangAttackPhase('third-roll');
      setWushuangSelectedDirection(null); // 重置方向选择
      addLog('进入第三阶段', 'info');
    }
  };

  // 第三阶段：消耗1点行动值掷骰子，若结果为1则再攻击一次
  const executeWushuangThirdRoll = () => {
    if (isOnlineMode) {
      // 在线模式：发送第三阶段掷骰请求
      colyseusService.wushuangThirdRoll();
      return;
    }

    // 单机模式的原有逻辑
    const general = Object.values(units).find(u =>
      u.owner === currentPlayer &&
      u.type === UnitType.GENERAL
    );

    if (!general) return;

    // 检查行动值是否足够
    if (currentActionPoints < 1) {
      addLog('行动值不足，扇形攻击结束', 'info');
      setTimeout(() => cancelWushuangFanAttack(), 1000);
      return;
    }

    // 消耗1点行动值（不触发自动回合切换）
    consumeActionPointNoAutoSwitch(currentPlayer, 1);
    addLog('消耗1点行动值掷骰', 'info');

    // 掷骰子
    const roll = Math.floor(Math.random() * 6) + 1;
    addLog(`第三阶段掷骰结果：${roll}`, 'info');
    setWushuangDiceRolls([...wushuangDiceRolls, roll]);

    if (roll === 1) {
      addLog(`掷出1！可以进行第三次攻击，请选择方向`, 'info');
      // 重置方向选择，让玩家重新选择攻击方向
      setWushuangSelectedDirection(null);
      setWushuangAttackPhase('third-attack');
    } else {
      addLog(`掷出${roll}，第三次攻击未触发`, 'info');
      // 完成攻击
      setTimeout(() => cancelWushuangFanAttack(), 1500);
    }
  };

  // 执行第二次扇形攻击（第二阶段掷骰成功后）
  const executeSecondFanAttack = () => {
    if (isOnlineMode) {
      // 在线模式：发送执行攻击请求（服务器已经知道是second-attack阶段）
      colyseusService.wushuangExecuteAttack();
      return;
    }

    // 单机模式的原有逻辑
    if (wushuangSelectedDirection === null) {
      addLog('请先选择攻击方向', 'info');
      return;
    }

    const general = Object.values(units).find(u =>
      u.owner === currentPlayer &&
      u.type === UnitType.GENERAL
    );

    if (!general) return;

    const fanHexes = getFanShapedHexes(general.position, wushuangSelectedDirection, 3, 5);
    const enemyUnitsInFan = Object.values(units).filter(u =>
      u.owner !== currentPlayer &&
      fanHexes.some(hex => hexEquals(hex, u.position))
    );

    enemyUnitsInFan.forEach(target => {
      const targetUnit = units[target.id];
      if (!targetUnit) return;

      const newHp = targetUnit.hp - 1;
      if (newHp <= 0) {
        removeUnit(targetUnit.id);
        useGameStore.getState().recordKill(currentPlayer);
        if (targetUnit.type === UnitType.GENERAL) {
          useGameStore.getState().removeDice(targetUnit.owner, 1);
        }
        addLog(`第二次攻击击杀了${targetUnit.type}！`, 'kill');
      } else {
        updateUnit(targetUnit.id, {
          hp: newHp,
          isFlipped: true,
        });
        addLog(`第二次攻击命中${targetUnit.type}`, 'attack');
      }
    });

    // 进入第三阶段
    setWushuangAttackPhase('third-roll');
    setWushuangSelectedDirection(null);
    addLog('第二次攻击完成，进入第三阶段', 'info');
  };

  // 执行第三次扇形攻击（第三阶段掷骰成功后）
  const executeThirdFanAttack = () => {
    if (isOnlineMode) {
      // 在线模式：发送执行攻击请求（服务器已经知道是third-attack阶段）
      colyseusService.wushuangExecuteAttack();
      return;
    }

    // 单机模式的原有逻辑
    if (wushuangSelectedDirection === null) {
      addLog('请先选择攻击方向', 'info');
      return;
    }

    const general = Object.values(units).find(u =>
      u.owner === currentPlayer &&
      u.type === UnitType.GENERAL
    );

    if (!general) return;

    const fanHexes = getFanShapedHexes(general.position, wushuangSelectedDirection, 3, 5);
    const enemyUnitsInFan = Object.values(units).filter(u =>
      u.owner !== currentPlayer &&
      fanHexes.some(hex => hexEquals(hex, u.position))
    );

    enemyUnitsInFan.forEach(target => {
      const targetUnit = units[target.id];
      if (!targetUnit) return;

      const newHp = targetUnit.hp - 1;
      if (newHp <= 0) {
        removeUnit(targetUnit.id);
        useGameStore.getState().recordKill(currentPlayer);
        if (targetUnit.type === UnitType.GENERAL) {
          useGameStore.getState().removeDice(targetUnit.owner, 1);
        }
        addLog(`第三次攻击击杀了${targetUnit.type}！`, 'kill');
      } else {
        updateUnit(targetUnit.id, {
          hp: newHp,
          isFlipped: true,
        });
        addLog(`第三次攻击命中${targetUnit.type}`, 'attack');
      }
    });

    addLog('无双扇形攻击全部完成！', 'info');
    // 完成攻击
    setTimeout(() => cancelWushuangFanAttack(), 1500);
  };

  const cancelWushuangFanAttack = () => {
    // 清除高亮（在线和单机模式都需要）
    setHighlightedHexes([]);

    if (isOnlineMode) {
      // 在线模式：发送取消请求
      colyseusService.wushuangCancel();
      return;
    }

    // 单机模式的原有逻辑
    setWushuangFanAttackActive(false);
    setWushuangTargets([]);
    setWushuangDiceRolls([]);
    setWushuangSelectedDirection(null);
    setWushuangAttackPhase('select-direction');
    addLog('无双扇形攻击结束', 'info');
  };

  // 如果在部署阶段且还没掷骰子（检查是否有骰子结果来判断是否已投骰）
  const diceResults = currentPlayer === Player.PLAYER1 ? player1DiceResults : player2DiceResults;
  const hasRolled = diceResults && diceResults.length > 0;

  if (phase === GamePhase.DEPLOY && currentActionPoints === 0 && !hasRolled) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-blue-50 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-xl p-8 text-center">
          <h2 className="text-3xl font-bold mb-4">
            {currentPlayer === Player.PLAYER1 ? '玩家 1' : '玩家 2'} 的回合
          </h2>
          {!isMyTurn && (
            <p className="text-gray-600 mb-4">等待对手操作...</p>
          )}
          <button
            onClick={handleRollDice}
            disabled={!isMyTurn}
            className={`px-8 py-4 rounded-lg font-bold text-xl ${
              isMyTurn
                ? 'bg-blue-500 text-white hover:bg-blue-600 cursor-pointer'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            掷骰子开始
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-blue-50 p-4">
      <div className="max-w-7xl mx-auto">
        {/* 非你回合提示 */}
        {!isMyTurn && isOnlineMode && (
          <div className="bg-yellow-100 border-2 border-yellow-400 rounded-lg p-3 mb-4 text-center">
            <p className="text-yellow-800 font-bold text-lg">
              ⏳ 等待对手操作...
            </p>
          </div>
        )}

        {/* 顶部信息栏 */}
        <div className="bg-white rounded-lg shadow-lg p-4 mb-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-2xl font-bold">
                {currentPlayer === Player.PLAYER1 ? '玩家 1' : '玩家 2'} 的回合
              </h2>
              <p className="text-sm text-gray-600">
                {phase === GamePhase.DEPLOY ? '部署阶段' : '行动阶段'}
              </p>
            </div>
            <div className="flex items-center gap-6">
              {/* 部署价值显示 */}
              <div className="text-center">
                <p className="text-sm text-gray-600">部署价值</p>
                <p className="text-2xl font-bold text-purple-600">
                  {(currentPlayer === Player.PLAYER1 ? player1DeployedValue : player2DeployedValue).toFixed(1)}元
                </p>
                <p className="text-xs text-gray-500">
                  {phase === GamePhase.DEPLOY ? (
                    // 部署阶段：后手玩家的骰子数基于先手玩家的部署价值（每1元1颗）
                    currentPlayer === Player.PLAYER2 ? (
                      <>骰子: {1 + Math.floor(player1DeployedValue)}颗 (基于对方)</>
                    ) : (
                      <>先手无限行动点</>
                    )
                  ) : (
                    // 行动阶段：骰子数基于自己的部署价值（每2元1颗）
                    <>骰子: {1 + Math.floor((currentPlayer === Player.PLAYER1 ? player1DeployedValue : player2DeployedValue) / 2)}颗</>
                  )}
                </p>
              </div>

              <div className="text-center">
                <p className="text-sm text-gray-600">行动点</p>
                {(() => {
                  const tempMax = currentPlayer === Player.PLAYER1 ? player1TempMaxActionPoints : player2TempMaxActionPoints;
                  const diceSum = (currentPlayer === Player.PLAYER1 ? player1DiceResults : player2DiceResults)
                    .reduce((sum, val) => sum + val, 0);

                  if (tempMax !== null) {
                    // 有临时上限,显示为 (当前/临时上限)
                    return (
                      <p className="text-3xl font-bold text-blue-600">
                        {currentActionPoints}
                        <span className="text-lg text-gray-500">/{tempMax}</span>
                      </p>
                    );
                  } else {
                    // 没有临时上限,显示为 (当前/骰子总和)
                    return (
                      <p className="text-3xl font-bold text-blue-600">
                        {currentActionPoints}
                        <span className="text-lg text-gray-500">/{diceSum}</span>
                      </p>
                    );
                  }
                })()}
                {/* 显示骰子结果 */}
                {(() => {
                  const diceResults = currentPlayer === Player.PLAYER1 ? player1DiceResults : player2DiceResults;
                  const killDice = currentPlayer === Player.PLAYER1 ? player1KillDice : player2KillDice;
                  const lostDice = currentPlayer === Player.PLAYER1 ? player1LostDice : player2LostDice;
                  const totalDice = currentPlayer === Player.PLAYER1 ? player1Dice : player2Dice;

                  if (diceResults && diceResults.length > 0) {
                    // 基础骰子数 = 总骰子数 - 击杀骰子数
                    const baseDice = totalDice - killDice;

                    return (
                      <div>
                        {/* 骰子数量说明 */}
                        <div className="text-xs text-gray-600 mb-1 flex justify-center gap-3">
                          <span className="text-blue-600">基础:{baseDice}个</span>
                          {killDice > 0 && <span className="text-yellow-600">击杀奖励:+{killDice}个</span>}
                          {lostDice > 0 && <span className="text-gray-500">永久失去:{lostDice}个</span>}
                        </div>
                        <div className="flex gap-1.5 justify-center flex-wrap">
                        {/* 基础骰子 - 蓝色边框 */}
                        {diceResults.slice(0, baseDice).map((result, index) => (
                          <span
                            key={`base-${index}`}
                            onClick={() => handleDiceClick(index, currentPlayer)}
                            className={`inline-flex items-center justify-center w-8 h-8 bg-white border-2 rounded-md text-sm font-bold shadow-sm transition-all ${
                              shenjiAbilityActive || rerollMode ? 'cursor-pointer hover:bg-blue-100 hover:scale-110' : ''
                            } ${
                              selectedDiceIndex === index ? 'border-purple-500 bg-purple-100 scale-110' : rerollMode ? 'border-orange-500' : 'border-blue-500'
                            }`}
                          >
                            {result}
                          </span>
                        ))}
                        {/* 击杀骰子 - 金色边框 */}
                        {diceResults.slice(baseDice, baseDice + killDice).map((result, index) => {
                          const actualIndex = baseDice + index;
                          return (
                            <span
                              key={`kill-${index}`}
                              onClick={() => handleDiceClick(actualIndex, currentPlayer)}
                              className={`inline-flex items-center justify-center w-8 h-8 bg-white border-2 rounded-md text-sm font-bold shadow-sm transition-all ${
                                shenjiAbilityActive || rerollMode ? 'cursor-pointer hover:bg-yellow-100 hover:scale-110' : ''
                              } ${
                                selectedDiceIndex === actualIndex ? 'border-purple-500 bg-purple-100 scale-110' : rerollMode ? 'border-orange-500' : 'border-yellow-500'
                              }`}
                            >
                              {result}
                            </span>
                          );
                        })}
                        {/* 失去的骰子 - 灰色边框，无数字 */}
                        {Array.from({ length: lostDice }).map((_, index) => (
                          <span
                            key={`lost-${index}`}
                            className="inline-flex items-center justify-center w-8 h-8 bg-gray-200 border-2 border-gray-400 rounded-md text-sm font-bold opacity-50 shadow-sm"
                          >
                            ✕
                          </span>
                        ))}
                      </div>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleEndTurn}
                  disabled={!isMyTurn}
                  className={`px-6 py-3 rounded-lg font-bold ${
                    isMyTurn
                      ? 'bg-red-500 text-white hover:bg-red-600 cursor-pointer'
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  结束回合
                </button>

                {/* 开发用：重置技能按钮 */}
                <button
                  onClick={() => {
                    // 找到当前玩家的将领
                    const general = Object.values(units).find(u =>
                      u.owner === currentPlayer &&
                      u.type === UnitType.GENERAL
                    );

                    if (general) {
                      updateUnit(general.id, {
                        abilityUsed: false,
                        bonusActionLimit: 0,
                      } as any);
                      addLog('[DEV] 技能已重置', 'info');
                    }
                  }}
                  className="px-4 py-3 bg-purple-500 text-white rounded-lg font-bold hover:bg-purple-600 text-sm"
                >
                  [DEV] 重置技能
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          {/* 地图区域 */}
          <div className="col-span-3 bg-white rounded-lg shadow-lg p-4" style={{ height: '700px', position: 'relative' }}>
            <HexMap
              radius={5}
              hexSize={40}
              onHexClick={handleHexClick}
              highlightedHexes={highlightedHexes}
            />
            {/* 渲染所有单位 */}
            <svg
              width="100%"
              height="100%"
              viewBox={(() => {
                const radius = 5;
                const hexSize = 40;
                const maxX = hexSize * Math.sqrt(3) * radius;
                const maxY = hexSize * 1.5 * radius;
                const padding = hexSize;
                const minX = -maxX - padding;
                const minY = -maxY - padding;
                const width = (maxX + padding) * 2;
                const height = (maxY + padding) * 2;
                return `${minX} ${minY} ${width} ${height}`;
              })()}
              style={{ position: 'absolute', top: '1rem', left: '1rem', width: 'calc(100% - 2rem)', height: 'calc(100% - 2rem)', pointerEvents: 'none' }}
            >
              {/* 渲染射击路径 */}
              {actionMode === 'rotate' && rotationPaths.size > 0 && (() => {
                const pathColors = [
                  '#ef4444', // 红色 - EAST (东)
                  '#f97316', // 橙色 - NORTH_EAST (东北)
                  '#eab308', // 黄色 - NORTH_WEST (西北)
                  '#22c55e', // 绿色 - WEST (西)
                  '#3b82f6', // 蓝色 - SOUTH_WEST (西南)
                  '#a855f7', // 紫色 - SOUTH_EAST (东南)
                ];
                const directions = [
                  Direction.EAST,
                  Direction.NORTH_EAST,
                  Direction.NORTH_WEST,
                  Direction.WEST,
                  Direction.SOUTH_WEST,
                  Direction.SOUTH_EAST,
                ];

                return directions.map((dir, index) => {
                  const path = rotationPaths.get(dir);
                  if (!path || path.length === 0) return null;

                  return (
                    <g key={dir}>
                      {path.map((hex, i) => {
                        const pixel = hexToPixel(hex, 40);
                        return (
                          <circle
                            key={`${hex.q}-${hex.r}-${hex.s}`}
                            cx={pixel.x}
                            cy={pixel.y}
                            r={15}
                            fill={pathColors[index]}
                            opacity={0.4}
                            style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRotationPathClick(hex);
                            }}
                          />
                        );
                      })}
                    </g>
                  );
                });
              })()}

              {/* 渲染机关单位占用的格子 */}
              {Object.values(units).filter(u => u.type === UnitType.BALLISTA || u.type === UnitType.CHARIOT).map(unit => {
                const hexSize = 40;
                const machineTypeStr = unit.type === UnitType.BALLISTA ? 'ballista' : 'chariot';
                const occupiedHexes = getMachineOccupiedHexes(unit.position, machineTypeStr);

                return (
                  <g key={`machine-${unit.id}`} opacity={0.3}>
                    {/* 渲染除中心位置外的所有占用格子 */}
                    {occupiedHexes.slice(1).map((hex, index) => {
                      const pixel = hexToPixel(hex, hexSize);
                      return (
                        <circle
                          key={`${unit.id}-hex-${index}`}
                          cx={pixel.x}
                          cy={pixel.y}
                          r={12}
                          fill={unit.owner === Player.PLAYER1 ? '#fbbf24' : '#60a5fa'}
                        />
                      );
                    })}
                  </g>
                );
              })}

              {Object.values(units).map(unit => (
                <g key={unit.id} style={{ pointerEvents: 'auto' }}>
                  <UnitPiece
                    unit={unit}
                    hexSize={40}
                    onClick={() => handleUnitClick(unit.id)}
                    isSelected={unit.id === selectedUnitId}
                  />
                </g>
              ))}
            </svg>
          </div>

          {/* 右侧操作面板 */}
          <div className="space-y-4">
            {/* 选中单位信息 */}
            {selectedUnit && (
              <div className="bg-white rounded-lg shadow-lg p-4">
                <h3 className="text-lg font-bold mb-2">选中单位</h3>
                <div className="space-y-2">
                  <p><strong>类型:</strong> {selectedUnit.type}</p>
                  <p><strong>生命:</strong> {selectedUnit.hp}/{selectedUnit.maxHp}</p>
                  <p>
                    <strong>行动:</strong> {selectedUnit.actionsThisTurn}/
                    {(() => {
                      // 弩车特殊处理：行动次数上限为1
                      if (selectedUnit.type === UnitType.BALLISTA) {
                        return 1;
                      }
                      // 战车特殊处理：行动次数上限为1
                      if (selectedUnit.type === UnitType.CHARIOT) {
                        return 1;
                      }
                      // 将军可能有额外行动次数
                      const bonusActions = (selectedUnit.type === UnitType.GENERAL && 'bonusActionLimit' in selectedUnit && typeof selectedUnit.bonusActionLimit === 'number')
                        ? selectedUnit.bonusActionLimit
                        : 0;
                      return 2 + bonusActions;
                    })()}
                  </p>
                </div>

                <div className="mt-4 space-y-2">
                  <button
                    onClick={handleShowMoves}
                    disabled={!isMyTurn || currentActionPoints < 1 || (() => {
                      // 部署阶段：玩家1不能移动，玩家2可以移动
                      if (phase === GamePhase.DEPLOY && currentPlayer === Player.PLAYER1) return true;

                      // 弩车特殊处理：行动次数上限为1
                      if (selectedUnit.type === UnitType.BALLISTA) {
                        if (selectedUnit.actionsThisTurn >= 1) return true;
                        if ('hasActedThisTurn' in selectedUnit && selectedUnit.hasActedThisTurn) return true;
                        return false;
                      }

                      // 战车特殊处理：行动次数上限为1
                      if (selectedUnit.type === UnitType.CHARIOT) {
                        if (selectedUnit.actionsThisTurn >= 1) return true;
                        if ('hasActedThisTurn' in selectedUnit && selectedUnit.hasActedThisTurn) return true;
                        return false;
                      }

                      // 计算行动次数上限（普通单位和将军）
                      const bonusActions = (selectedUnit.type === UnitType.GENERAL && 'bonusActionLimit' in selectedUnit && typeof selectedUnit.bonusActionLimit === 'number')
                        ? selectedUnit.bonusActionLimit
                        : 0;
                      const actionLimit = 2 + bonusActions;

                      // 检查是否已达到行动次数上限
                      if (selectedUnit.actionsThisTurn >= actionLimit) return true;

                      // 检查是否有无限行动标志
                      const hasUnlimitedActions = 'unlimitedActions' in selectedUnit && selectedUnit.unlimitedActions;

                      // 如果没有无限行动且没有额外行动次数，检查是否已移动过
                      if (!hasUnlimitedActions && bonusActions === 0 && selectedUnit.hasMoved) return true;

                      return false;
                    })()}
                    className="w-full px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm"
                  >
                    移动 {!isMyTurn ? '(非你的回合)' : phase === GamePhase.DEPLOY && currentPlayer === Player.PLAYER1 ? '(部署阶段不可用)' : ''}
                  </button>

                  {/* 无双将领：扇形攻击替代普通攻击 */}
                  {selectedUnit.type === UnitType.GENERAL && 'generalType' in selectedUnit && selectedUnit.generalType === 'wushuang' ? (
                    <>
                      <button
                        onClick={handleWushuangFanAttack}
                        disabled={!isMyTurn || (() => {
                          if (phase === GamePhase.DEPLOY || currentActionPoints < 3) return true;

                          // 计算行动次数上限
                          const bonusActions = ('bonusActionLimit' in selectedUnit && typeof selectedUnit.bonusActionLimit === 'number')
                            ? selectedUnit.bonusActionLimit
                            : 0;
                          const actionLimit = 2 + bonusActions;

                          // 检查是否已达到行动次数上限
                          if (selectedUnit.actionsThisTurn >= actionLimit) return true;

                          // 检查是否有无限行动标志
                          const hasUnlimitedActions = 'unlimitedActions' in selectedUnit && selectedUnit.unlimitedActions;

                          // 如果没有无限行动且没有额外行动次数，检查是否已使用过扇形攻击
                          if (!hasUnlimitedActions && bonusActions === 0 && 'hasFanAttacked' in selectedUnit && selectedUnit.hasFanAttacked) return true;

                          return false;
                        })()}
                        className="w-full px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm font-bold"
                      >
                        扇形攻击（消耗3点）
                        {!isMyTurn ? '(非你的回合)' : phase === GamePhase.DEPLOY ? '(部署阶段不可用)' : ''}
                        {(() => {
                          const bonusActions = ('bonusActionLimit' in selectedUnit && typeof selectedUnit.bonusActionLimit === 'number')
                            ? selectedUnit.bonusActionLimit
                            : 0;
                          const actionLimit = 2 + bonusActions;

                          // 如果已达到行动次数上限
                          if (selectedUnit.actionsThisTurn >= actionLimit) return '(已达上限)';

                          // 检查是否有无限行动标志
                          const hasUnlimitedActions = 'unlimitedActions' in selectedUnit && selectedUnit.unlimitedActions;

                          // 如果没有无限行动且没有额外行动次数且已使用过
                          if (!hasUnlimitedActions && bonusActions === 0 && 'hasFanAttacked' in selectedUnit && selectedUnit.hasFanAttacked) return '(已使用)';

                          return '';
                        })()}
                      </button>

                      {/* 无双扇形攻击控制面板 */}
                      {wushuangFanAttackActive && (
                        <div className="mt-3 p-3 bg-orange-50 rounded-lg border-2 border-orange-300">
                          <h4 className="text-sm font-bold mb-2 text-orange-700">扇形攻击进行中</h4>

                          {/* 第一阶段：选择方向 */}
                          {wushuangAttackPhase === 'select-direction' && (
                            <div className="space-y-2">
                              <p className="text-xs text-gray-700 text-center">
                                选择攻击方向（120°扇形，消耗3点行动值）
                              </p>

                              {/* 方向选择器 */}
                              <div className="relative" style={{ height: '120px' }}>
                                <button onClick={() => handleWushuangSelectDirection(Direction.NORTH_WEST)}
                                  className={`absolute left-1 top-1 px-2 py-1 text-xs rounded font-semibold transition-all ${
                                    wushuangSelectedDirection === Direction.NORTH_WEST
                                      ? 'bg-orange-600 text-white shadow-lg'
                                      : 'bg-orange-100 text-orange-800 hover:bg-orange-200'
                                  }`}>
                                  ↖
                                </button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.NORTH_EAST)}
                                  className={`absolute right-1 top-1 px-2 py-1 text-xs rounded font-semibold transition-all ${
                                    wushuangSelectedDirection === Direction.NORTH_EAST
                                      ? 'bg-orange-600 text-white shadow-lg'
                                      : 'bg-orange-100 text-orange-800 hover:bg-orange-200'
                                  }`}>
                                  ↗
                                </button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.WEST)}
                                  className={`absolute left-1 top-1/2 -translate-y-1/2 px-2 py-1 text-xs rounded font-semibold transition-all ${
                                    wushuangSelectedDirection === Direction.WEST
                                      ? 'bg-orange-600 text-white shadow-lg'
                                      : 'bg-orange-100 text-orange-800 hover:bg-orange-200'
                                  }`}>
                                  ←
                                </button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.EAST)}
                                  className={`absolute right-1 top-1/2 -translate-y-1/2 px-2 py-1 text-xs rounded font-semibold transition-all ${
                                    wushuangSelectedDirection === Direction.EAST
                                      ? 'bg-orange-600 text-white shadow-lg'
                                      : 'bg-orange-100 text-orange-800 hover:bg-orange-200'
                                  }`}>
                                  →
                                </button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.SOUTH_WEST)}
                                  className={`absolute left-1 bottom-1 px-2 py-1 text-xs rounded font-semibold transition-all ${
                                    wushuangSelectedDirection === Direction.SOUTH_WEST
                                      ? 'bg-orange-600 text-white shadow-lg'
                                      : 'bg-orange-100 text-orange-800 hover:bg-orange-200'
                                  }`}>
                                  ↙
                                </button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.SOUTH_EAST)}
                                  className={`absolute right-1 bottom-1 px-2 py-1 text-xs rounded font-semibold transition-all ${
                                    wushuangSelectedDirection === Direction.SOUTH_EAST
                                      ? 'bg-orange-600 text-white shadow-lg'
                                      : 'bg-orange-100 text-orange-800 hover:bg-orange-200'
                                  }`}>
                                  ↘
                                </button>
                              </div>

                              <div className="flex gap-2">
                                <button
                                  onClick={executeWushuangFanAttack}
                                  disabled={wushuangSelectedDirection === null}
                                  className="flex-1 px-2 py-1 bg-orange-500 text-white rounded font-bold hover:bg-orange-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-xs"
                                >
                                  确认攻击
                                </button>
                                <button
                                  onClick={cancelWushuangFanAttack}
                                  className="px-2 py-1 bg-gray-500 text-white rounded font-bold hover:bg-gray-600 transition-colors text-xs"
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          )}

                          {/* 第二阶段：消耗2点行动值掷骰 */}
                          {wushuangAttackPhase === 'second-roll' && (
                            <div className="space-y-2">
                              <div className="p-2 bg-white rounded border border-orange-300">
                                <p className="text-xs font-bold text-orange-800">✓ 第一次攻击完成</p>
                                {wushuangDiceRolls.length > 0 && (
                                  <div className="flex items-center gap-1 mt-1">
                                    <span className="text-xs text-gray-600">已掷骰：</span>
                                    {wushuangDiceRolls.map((roll, i) => (
                                      <span key={i} className="inline-flex items-center justify-center w-6 h-6 bg-white border-2 border-orange-400 rounded text-xs font-bold text-orange-600">
                                        {roll}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                <p className="text-xs text-orange-700 mt-1">
                                  消耗<span className="font-bold">2点</span>掷骰，≤2可再攻击
                                </p>
                                {currentActionPoints < 2 && (
                                  <p className="text-xs text-red-600 mt-1 font-semibold">
                                    ⚠️ 行动值不足
                                  </p>
                                )}
                              </div>

                              <div className="flex gap-2">
                                <button
                                  onClick={executeWushuangSecondRoll}
                                  disabled={currentActionPoints < 2 || wushuangDiceRolls.length > 0}
                                  className="flex-1 px-2 py-1 bg-blue-500 text-white rounded font-bold hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-xs"
                                >
                                  {wushuangDiceRolls.length > 0 ? '已掷骰' : (currentActionPoints < 2 ? '行动值不足' : '掷骰(消耗2点)')}
                                </button>
                                <button
                                  onClick={cancelWushuangFanAttack}
                                  className="px-2 py-1 bg-gray-500 text-white rounded font-bold hover:bg-gray-600 transition-colors text-xs"
                                >
                                  结束
                                </button>
                              </div>
                            </div>
                          )}

                          {/* 第二阶段：选择第二次攻击方向 */}
                          {wushuangAttackPhase === 'second-attack' && (
                            <div className="space-y-2">
                              <p className="text-xs text-gray-700 text-center">
                                选择第二次攻击方向
                              </p>

                              <div className="relative" style={{ height: '120px' }}>
                                <button onClick={() => handleWushuangSelectDirection(Direction.NORTH_WEST)}
                                  className={`absolute left-1 top-1 px-2 py-1 text-xs rounded font-semibold transition-all ${wushuangSelectedDirection === Direction.NORTH_WEST ? 'bg-orange-600 text-white shadow-lg' : 'bg-orange-100 text-orange-800 hover:bg-orange-200'}`}>↖</button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.NORTH_EAST)}
                                  className={`absolute right-1 top-1 px-2 py-1 text-xs rounded font-semibold transition-all ${wushuangSelectedDirection === Direction.NORTH_EAST ? 'bg-orange-600 text-white shadow-lg' : 'bg-orange-100 text-orange-800 hover:bg-orange-200'}`}>↗</button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.WEST)}
                                  className={`absolute left-1 top-1/2 -translate-y-1/2 px-2 py-1 text-xs rounded font-semibold transition-all ${wushuangSelectedDirection === Direction.WEST ? 'bg-orange-600 text-white shadow-lg' : 'bg-orange-100 text-orange-800 hover:bg-orange-200'}`}>←</button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.EAST)}
                                  className={`absolute right-1 top-1/2 -translate-y-1/2 px-2 py-1 text-xs rounded font-semibold transition-all ${wushuangSelectedDirection === Direction.EAST ? 'bg-orange-600 text-white shadow-lg' : 'bg-orange-100 text-orange-800 hover:bg-orange-200'}`}>→</button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.SOUTH_WEST)}
                                  className={`absolute left-1 bottom-1 px-2 py-1 text-xs rounded font-semibold transition-all ${wushuangSelectedDirection === Direction.SOUTH_WEST ? 'bg-orange-600 text-white shadow-lg' : 'bg-orange-100 text-orange-800 hover:bg-orange-200'}`}>↙</button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.SOUTH_EAST)}
                                  className={`absolute right-1 bottom-1 px-2 py-1 text-xs rounded font-semibold transition-all ${wushuangSelectedDirection === Direction.SOUTH_EAST ? 'bg-orange-600 text-white shadow-lg' : 'bg-orange-100 text-orange-800 hover:bg-orange-200'}`}>↘</button>
                              </div>

                              <div className="flex gap-2">
                                <button
                                  onClick={executeSecondFanAttack}
                                  disabled={wushuangSelectedDirection === null}
                                  className="flex-1 px-2 py-1 bg-orange-500 text-white rounded font-bold hover:bg-orange-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-xs"
                                >
                                  确认第二次攻击
                                </button>
                                <button
                                  onClick={cancelWushuangFanAttack}
                                  className="px-2 py-1 bg-gray-500 text-white rounded font-bold hover:bg-gray-600 transition-colors text-xs"
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          )}

                          {/* 第三阶段：消耗1点行动值掷骰 */}
                          {wushuangAttackPhase === 'third-roll' && (
                            <div className="space-y-2">
                              <div className="p-2 bg-white rounded border border-orange-300">
                                <p className="text-xs font-bold text-orange-800">✓ 第二阶段完成</p>
                                {wushuangDiceRolls.length > 0 && (
                                  <div className="flex items-center gap-1 mt-1">
                                    <span className="text-xs text-gray-600">之前：</span>
                                    {wushuangDiceRolls.map((roll, i) => (
                                      <span key={i} className="inline-flex items-center justify-center w-5 h-5 bg-white border-2 border-orange-400 rounded text-xs font-bold text-orange-600">
                                        {roll}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                <p className="text-xs text-orange-700 mt-1">
                                  消耗<span className="font-bold">1点</span>掷骰，=1可再攻击
                                </p>
                              </div>

                              <div className="flex gap-2">
                                <button
                                  onClick={executeWushuangThirdRoll}
                                  disabled={currentActionPoints < 1 || wushuangDiceRolls.length > 1}
                                  className="flex-1 px-2 py-1 bg-purple-500 text-white rounded font-bold hover:bg-purple-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-xs"
                                >
                                  {wushuangDiceRolls.length > 1 ? '已掷骰' : (currentActionPoints < 1 ? '行动值不足' : '掷骰(消耗1点)')}
                                </button>
                                <button
                                  onClick={cancelWushuangFanAttack}
                                  className="px-2 py-1 bg-gray-500 text-white rounded font-bold hover:bg-gray-600 transition-colors text-xs"
                                >
                                  结束
                                </button>
                              </div>
                            </div>
                          )}

                          {/* 第三阶段：选择第三次攻击方向 */}
                          {wushuangAttackPhase === 'third-attack' && (
                            <div className="space-y-2">
                              <p className="text-xs text-gray-700 text-center">
                                选择第三次攻击方向
                              </p>

                              <div className="relative" style={{ height: '120px' }}>
                                <button onClick={() => handleWushuangSelectDirection(Direction.NORTH_WEST)}
                                  className={`absolute left-1 top-1 px-2 py-1 text-xs rounded font-semibold transition-all ${wushuangSelectedDirection === Direction.NORTH_WEST ? 'bg-orange-600 text-white shadow-lg' : 'bg-orange-100 text-orange-800 hover:bg-orange-200'}`}>↖</button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.NORTH_EAST)}
                                  className={`absolute right-1 top-1 px-2 py-1 text-xs rounded font-semibold transition-all ${wushuangSelectedDirection === Direction.NORTH_EAST ? 'bg-orange-600 text-white shadow-lg' : 'bg-orange-100 text-orange-800 hover:bg-orange-200'}`}>↗</button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.WEST)}
                                  className={`absolute left-1 top-1/2 -translate-y-1/2 px-2 py-1 text-xs rounded font-semibold transition-all ${wushuangSelectedDirection === Direction.WEST ? 'bg-orange-600 text-white shadow-lg' : 'bg-orange-100 text-orange-800 hover:bg-orange-200'}`}>←</button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.EAST)}
                                  className={`absolute right-1 top-1/2 -translate-y-1/2 px-2 py-1 text-xs rounded font-semibold transition-all ${wushuangSelectedDirection === Direction.EAST ? 'bg-orange-600 text-white shadow-lg' : 'bg-orange-100 text-orange-800 hover:bg-orange-200'}`}>→</button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.SOUTH_WEST)}
                                  className={`absolute left-1 bottom-1 px-2 py-1 text-xs rounded font-semibold transition-all ${wushuangSelectedDirection === Direction.SOUTH_WEST ? 'bg-orange-600 text-white shadow-lg' : 'bg-orange-100 text-orange-800 hover:bg-orange-200'}`}>↙</button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.SOUTH_EAST)}
                                  className={`absolute right-1 bottom-1 px-2 py-1 text-xs rounded font-semibold transition-all ${wushuangSelectedDirection === Direction.SOUTH_EAST ? 'bg-orange-600 text-white shadow-lg' : 'bg-orange-100 text-orange-800 hover:bg-orange-200'}`}>↘</button>
                              </div>

                              <div className="flex gap-2">
                                <button
                                  onClick={executeThirdFanAttack}
                                  disabled={wushuangSelectedDirection === null}
                                  className="flex-1 px-2 py-1 bg-orange-500 text-white rounded font-bold hover:bg-orange-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-xs"
                                >
                                  确认第三次攻击
                                </button>
                                <button
                                  onClick={cancelWushuangFanAttack}
                                  className="px-2 py-1 bg-gray-500 text-white rounded font-bold hover:bg-gray-600 transition-colors text-xs"
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  ) : selectedUnit.type === UnitType.BALLISTA ? (
                    /* 弩车：两种攻击方式 */
                    <div className="space-y-2">
                      <button
                        onClick={() => {
                          if (!selectedUnit) return;
                          // 贯穿攻击：显示射击路径
                          const isPlayerOne = selectedUnit.owner === Player.PLAYER1;
                          const shootingPath = getBallistaVerticalPath(selectedUnit.position, isPlayerOne, 5);
                          setHighlightedHexes(shootingPath);
                          setActionMode('attack');
                        }}
                        disabled={!isMyTurn || phase === GamePhase.DEPLOY || ('hasActedThisTurn' in selectedUnit && (selectedUnit as any).hasActedThisTurn) || selectedUnit.actionsThisTurn >= 1}
                        className="w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm"
                      >
                        贯穿攻击 (射击) {!isMyTurn ? '(非你的回合)' : phase === GamePhase.DEPLOY ? '(部署阶段不可攻击)' : ''}
                      </button>
                      <button
                        onClick={() => {
                          if (!selectedUnit) return;
                          // 近战攻击：获取弩车所有占用格子的相邻格子
                          const ballistaOccupiedHexes = getMachineOccupiedHexes(selectedUnit.position, 'ballista');
                          const allNeighbors: HexCoord[] = [];

                          // 获取所有占用格子的相邻格子（去重）
                          ballistaOccupiedHexes.forEach(occupiedHex => {
                            const neighbors = hexNeighbors(occupiedHex);
                            neighbors.forEach(neighbor => {
                              // 去重：检查是否已经在列表中，且不是弩车自己占用的格子
                              const isBallistaTile = ballistaOccupiedHexes.some(h => hexEquals(h, neighbor));
                              const alreadyAdded = allNeighbors.some(h => hexEquals(h, neighbor));
                              if (!isBallistaTile && !alreadyAdded) {
                                allNeighbors.push(neighbor);
                              }
                            });
                          });

                          // 过滤出有敌方单位的格子
                          const enemyTargets = allNeighbors.filter(neighborHex => {
                            return Object.values(units).some(u => {
                              if (u.owner === selectedUnit.owner || u.id === selectedUnit.id) return false;

                              // 检查普通单位
                              if (hexEquals(u.position, neighborHex)) return true;

                              // 检查机关单位的占用格子
                              if (u.type === UnitType.BALLISTA || u.type === UnitType.CHARIOT) {
                                const machineType = u.type === UnitType.BALLISTA ? 'ballista' : 'chariot';
                                const occupiedHexes = getMachineOccupiedHexes(u.position, machineType);
                                return occupiedHexes.some(hex => hexEquals(hex, neighborHex));
                              }

                              return false;
                            });
                          });

                          setHighlightedHexes(enemyTargets);
                          setActionMode('attack');
                        }}
                        disabled={!isMyTurn || phase === GamePhase.DEPLOY || ('hasActedThisTurn' in selectedUnit && (selectedUnit as any).hasActedThisTurn) || selectedUnit.actionsThisTurn >= 1}
                        className="w-full px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm"
                      >
                        近战攻击 {!isMyTurn ? '(非你的回合)' : phase === GamePhase.DEPLOY ? '(部署阶段不可攻击)' : ''}
                      </button>
                    </div>
                  ) : selectedUnit.type === UnitType.CHARIOT ? (
                    /* 战车：只能移动碾压，没有攻击按钮 */
                    <div className="text-sm text-gray-600 text-center py-2">
                      战车通过移动碾压敌人
                    </div>
                  ) : (
                    /* 其他单位：普通攻击 */
                    <button
                      onClick={handleShowAttacks}
                      disabled={!isMyTurn || currentActionPoints < 1 || phase === GamePhase.DEPLOY || selectedUnit.hasAttacked || selectedUnit.actionsThisTurn >= 2}
                      className="w-full px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm"
                    >
                      攻击 {!isMyTurn ? '(非你的回合)' : phase === GamePhase.DEPLOY ? '(部署阶段不可攻击)' : ''}
                    </button>
                  )}

                  {/* 弓箭手转向（弩车不能转向） */}
                  {selectedUnit.type === UnitType.ARCHER && (
                    <button
                      onClick={handleShowRotation}
                      disabled={
                        !isMyTurn ||
                        (phase === GamePhase.DEPLOY && currentPlayer === Player.PLAYER1) ||
                        (selectedUnit as any).hasRotated ||
                        currentActionPoints < 1
                      }
                      className="w-full px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm"
                    >
                      {actionMode === 'rotate' ? '选择射击方向' : '转向 (显示射程)'}
                      {!isMyTurn
                        ? ' (非你的回合)'
                        : (selectedUnit as any).hasRotated
                          ? ' (本回合已转向)'
                          : phase === GamePhase.DEPLOY && currentPlayer === Player.PLAYER1
                            ? ' (部署阶段不可用)'
                            : currentActionPoints < 1
                              ? ' (行动点不足)'
                              : ''}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* 部署面板 - 所有阶段都可以部署 */}
            <div className="bg-white rounded-lg shadow-lg p-4">
              <h3 className="text-lg font-bold mb-2">部署单位</h3>
              <p className="text-xs text-gray-600 mb-3">
                {actionMode === 'deploy'
                  ? '点击起始区部署单位'
                  : '选择要部署的单位类型'}
              </p>

              {actionMode === 'deploy' && (
                <button
                  onClick={handleCancelDeploy}
                  className="w-full px-4 py-2 mb-3 bg-gray-500 text-white rounded hover:bg-gray-600 text-sm"
                >
                  取消部署
                </button>
              )}

              <div className="space-y-2">
                <button
                  className="w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm disabled:bg-gray-300 disabled:cursor-not-allowed"
                  onClick={() => handleStartDeploy(UnitType.INFANTRY)}
                  disabled={!isMyTurn || army.infantry <= 0 || currentActionPoints < 1}
                >
                  步兵 ({army.infantry}/{army.infantry + deployedCounts.infantry}) {!isMyTurn ? '(非你的回合)' : ''}
                </button>
                <button
                  className="w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm disabled:bg-gray-300 disabled:cursor-not-allowed"
                  onClick={() => handleStartDeploy(UnitType.CAVALRY)}
                  disabled={!isMyTurn || army.cavalry <= 0 || currentActionPoints < 1}
                >
                  骑兵 ({army.cavalry}/{army.cavalry + deployedCounts.cavalry}) {!isMyTurn ? '(非你的回合)' : ''}
                </button>
                <button
                  className="w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm disabled:bg-gray-300 disabled:cursor-not-allowed"
                  onClick={() => handleStartDeploy(UnitType.ARCHER)}
                  disabled={!isMyTurn || deployedCounts.archer >= army.archer || currentActionPoints < 1}
                >
                  弓箭手 ({deployedCounts.archer}/{army.archer}) {!isMyTurn ? '(非你的回合)' : ''}
                </button>
                <button
                  className="w-full px-4 py-2 bg-amber-500 text-white rounded hover:bg-amber-600 text-sm font-bold disabled:bg-gray-300 disabled:cursor-not-allowed"
                  onClick={() => handleStartDeploy(UnitType.GENERAL)}
                  disabled={!isMyTurn || deployedCounts.general >= 1 || currentActionPoints < 1}
                >
                  将军 ({deployedCounts.general}/1) {!isMyTurn ? '(非你的回合)' : ''}
                </button>
              </div>
            </div>

            {/* 将军技能面板 */}
            {(() => {
              const currentGeneral = currentPlayer === Player.PLAYER1 ? player1General : player2General;
              const generalUnit = Object.values(units).find(u =>
                u.owner === currentPlayer && u.type === UnitType.GENERAL
              );

              if (!currentGeneral || !generalUnit) return null;

              return (
                <div className="bg-white rounded-lg shadow-lg p-4">
                  <h3 className="text-lg font-bold mb-2">将军技能</h3>

                  {/* 神机技能 */}
                  {currentGeneral === 'shenji' && (
                    <>
                      {/* 部署机关区域 */}
                      <div className="mb-4 p-3 bg-purple-50 rounded-lg border border-purple-200">
                        <h4 className="text-sm font-bold text-purple-700 mb-2">部署机关单位</h4>
                        <div className="space-y-2">
                          <button
                            className="w-full px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 text-sm font-bold disabled:bg-gray-300 disabled:cursor-not-allowed"
                            onClick={() => handleStartDeploy(UnitType.BALLISTA)}
                            disabled={!isMyTurn || currentActionPoints < 5}
                          >
                            弩车 (4步+1弓) - 5点 {!isMyTurn ? '(非你的回合)' : ''}
                          </button>
                          <button
                            className="w-full px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 text-sm font-bold disabled:bg-gray-300 disabled:cursor-not-allowed"
                            onClick={() => handleStartDeploy(UnitType.CHARIOT)}
                            disabled={!isMyTurn || currentActionPoints < 4}
                          >
                            战车 (6步) - 4点 {!isMyTurn ? '(非你的回合)' : ''}
                          </button>
                        </div>
                      </div>

                      {/* 神机技能区域 */}
                      <div className="mb-4 p-3 bg-indigo-50 rounded-lg border border-indigo-200">
                        <h4 className="text-sm font-bold text-indigo-700 mb-2">神机技能</h4>

                        {/* 被动技能：改骰 */}
                        {!shenjiAbilityActive && (
                          <button
                            onClick={handleShenjiAbility}
                            disabled={!isMyTurn}
                            className="w-full px-4 py-2 bg-indigo-500 text-white rounded hover:bg-indigo-600 text-sm font-bold disabled:bg-gray-300 disabled:cursor-not-allowed"
                          >
                            修改骰子 {!isMyTurn ? '(非你的回合)' : ''}
                          </button>
                        )}

                        {shenjiAbilityActive && (
                          <div className="space-y-2">
                            <p className="text-xs text-indigo-600 font-semibold">
                              {selectedDiceIndex !== null ? '选择新的点数（1-6）' : '点击要修改的骰子'}
                            </p>

                            {selectedDiceIndex !== null ? (
                              <div className="grid grid-cols-3 gap-2">
                                {[1, 2, 3, 4, 5, 6].map(value => (
                                  <button
                                    key={value}
                                    onClick={() => handleModifyDice(value)}
                                    className="px-3 py-2 bg-indigo-500 text-white rounded hover:bg-indigo-600 text-sm font-bold"
                                  >
                                    {value}
                                  </button>
                                ))}
                              </div>
                            ) : null}

                            <button
                              onClick={cancelShenjiAbility}
                              className="w-full px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 text-sm"
                            >
                              取消
                            </button>
                          </div>
                        )}

                        {('abilityUsed' in generalUnit && generalUnit.abilityUsed) ? (
                          <p className="text-xs text-gray-500 italic mt-2">技能已使用</p>
                        ) : null}
                      </div>

                      {/* 机关崩毁重投次数 */}
                      {(() => {
                        const rerollTokens = currentPlayer === Player.PLAYER1 ? player1RerollTokens : player2RerollTokens;
                        return (
                          <div className="p-3 bg-orange-50 rounded-lg border border-orange-200">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-bold text-orange-700">机关崩毁奖励</span>
                              <span className="text-xs bg-orange-200 text-orange-800 px-2 py-1 rounded font-bold">
                                重投次数: {rerollTokens}
                              </span>
                            </div>
                            {rerollTokens > 0 && !rerollMode && (
                              <button
                                onClick={() => {
                                  setRerollMode(true);
                                  addLog('选择要重投的骰子', 'info');
                                }}
                                disabled={!isMyTurn}
                                className="w-full px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 text-sm font-bold disabled:bg-gray-300 disabled:cursor-not-allowed"
                              >
                                重投骰子 {!isMyTurn ? '(非你的回合)' : ''}
                              </button>
                            )}
                            {rerollMode && (
                              <div className="space-y-2">
                                <p className="text-xs text-orange-600 font-semibold">
                                  点击要重投的骰子
                                </p>
                                <button
                                  onClick={() => {
                                    setRerollMode(false);
                                    addLog('取消重投', 'info');
                                  }}
                                  className="w-full px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 text-sm"
                                >
                                  取消
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </>
                  )}

                  {/* 无双技能 */}
                  {currentGeneral === 'wushuang' && (
                    <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                      <h4 className="text-sm font-bold text-red-700 mb-2">无双技能</h4>

                      {/* 一次性技能：获得已损失体力值的行动值 */}
                      {!('abilityUsed' in generalUnit && generalUnit.abilityUsed) ? (
                        <button
                          onClick={handleWushuangInvincibility}
                          disabled={!isMyTurn}
                          className="w-full px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 text-sm font-bold disabled:bg-gray-300 disabled:cursor-not-allowed"
                        >
                          获得已损失体力值的行动值 {!isMyTurn ? '(非你的回合)' : ''}
                        </button>
                      ) : (
                        <p className="text-xs text-gray-500 italic">一次性技能已使用</p>
                      )}
                    </div>
                  )}

                  {/* 仁德技能 */}
                  {currentGeneral === 'rende' && (
                    <>
                      {/* 一次性技能：转化接触单位 */}
                      <div className="mb-4 p-3 bg-green-50 rounded-lg border border-green-200">
                        <h4 className="text-sm font-bold text-green-700 mb-2">仁德技能（一次性）</h4>

                        {!('abilityUsed' in generalUnit && generalUnit.abilityUsed) ? (
                          <button
                            onClick={() => {
                              if (!selectedUnit) return;
                              // 激活转化接触单位模式
                              // 找到所有与将军相邻的单位（包括机关单位）
                              const adjacentHexes = hexNeighbors(selectedUnit.position);
                              const adjacentUnits: typeof units[keyof typeof units][] = [];

                              // 遍历所有单位，检查它们是否与将军相邻
                              Object.values(units).forEach(u => {
                                if (u.id === selectedUnit.id || u.owner === selectedUnit.owner) return;

                                // 检查机关单位的所有占用格子
                                if (u.type === UnitType.BALLISTA || u.type === UnitType.CHARIOT) {
                                  const machineType = u.type === UnitType.BALLISTA ? 'ballista' : 'chariot';
                                  const occupiedHexes = getMachineOccupiedHexes(u.position, machineType);
                                  const isAdjacent = occupiedHexes.some(hex =>
                                    adjacentHexes.some(adjHex => hexEquals(adjHex, hex))
                                  );
                                  if (isAdjacent && !adjacentUnits.find(au => au.id === u.id)) {
                                    adjacentUnits.push(u);
                                  }
                                } else {
                                  // 普通单位：检查核心位置
                                  const isAdjacent = adjacentHexes.some(hex => hexEquals(hex, u.position));
                                  if (isAdjacent) {
                                    adjacentUnits.push(u);
                                  }
                                }
                              });

                              // 高亮所有相邻单位的核心位置
                              setHighlightedHexes(adjacentUnits.map(u => u.position));
                              setActionMode('rende-convert');
                            }}
                            disabled={!isMyTurn || currentActionPoints < 2}
                            className="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm font-bold disabled:bg-gray-300 disabled:cursor-not-allowed"
                          >
                            转化接触单位（2点） {!isMyTurn ? '(非你的回合)' : ''}
                          </button>
                        ) : (
                          <p className="text-xs text-gray-500 italic">一次性技能已使用</p>
                        )}
                      </div>

                      {/* 转化为步兵技能（无限次） */}
                      <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                        <h4 className="text-sm font-bold text-emerald-700 mb-2">转化中立标记</h4>

                        {((): React.ReactNode => {
                          const convertCost = ('convertInfantryCost' in generalUnit && typeof generalUnit.convertInfantryCost === 'number')
                            ? generalUnit.convertInfantryCost
                            : 1;

                          return (
                            <button
                              onClick={() => {
                                if (!selectedUnit) return;
                                // 激活转化中立标记为步兵模式
                                const neutralMarkers = Object.values(units)
                                  .filter(u =>
                                    u.type === UnitType.NEUTRAL_MARKER &&
                                    u.owner === Player.NEUTRAL &&
                                    hexDistance(selectedUnit.position, u.position) === 1
                                  );

                                setHighlightedHexes(neutralMarkers.map(u => u.position));
                                setActionMode('rende-neutral');
                              }}
                              disabled={!isMyTurn || currentActionPoints < convertCost}
                              className="w-full px-4 py-2 bg-emerald-500 text-white rounded hover:bg-emerald-600 text-sm font-bold disabled:bg-gray-300 disabled:cursor-not-allowed"
                            >
                              转化为步兵（{convertCost}点） {!isMyTurn ? '(非你的回合)' : ''}
                            </button>
                          );
                        })()}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* 战斗日志 - 放在地图下方 */}
        <div className="mt-4">
          <BattleLog logs={battleLogs} maxEntries={8} />
        </div>
      </div>

      {/* 仁德击杀确认对话框 */}
      {rendeKillConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 shadow-xl max-w-md">
            <h3 className="text-xl font-bold mb-4">仁德将军击杀</h3>
            <p className="mb-6 text-gray-700">
              你的仁德将军即将击杀敌方{rendeKillConfirm.target.type}，请选择：
            </p>
            <div className="flex gap-4">
              <button
                onClick={() => {
                  if (isOnlineMode) {
                    // 在线模式：发送击杀确认到服务器
                    colyseusService.rendeCompleteKill(rendeKillConfirm.target.id);
                  } else {
                    // 单机模式：本地处理
                    rendeCompleteKill(rendeKillConfirm.target.id);
                  }
                  addLog(`仁德击杀了${rendeKillConfirm.target.type}`, 'kill');
                  setRendeKillConfirm(null);
                  selectUnit(null);
                }}
                className="flex-1 px-4 py-3 bg-red-500 text-white rounded hover:bg-red-600 font-bold"
              >
                直接击杀
              </button>
              <button
                onClick={() => {
                  if (isOnlineMode) {
                    // 在线模式：发送转为中立标记到服务器
                    colyseusService.rendeSpareAsNeutral(rendeKillConfirm.target.id);
                  } else {
                    // 单机模式：本地处理
                    rendeSpareAsNeutral(rendeKillConfirm.attacker.id, rendeKillConfirm.target.id);
                  }
                  addLog(`仁德将${rendeKillConfirm.target.type}转为中立标记`, 'ability');
                  setRendeKillConfirm(null);
                  selectUnit(null);
                }}
                disabled={(() => {
                  // 计算所需行动点：机关单位根据占用格子数，普通单位1点
                  let requiredPoints = 1;
                  if (rendeKillConfirm.target.type === UnitType.BALLISTA || rendeKillConfirm.target.type === UnitType.CHARIOT) {
                    const machineType = rendeKillConfirm.target.type === UnitType.BALLISTA ? 'ballista' : 'chariot';
                    const occupiedHexes = getMachineOccupiedHexes(rendeKillConfirm.target.position, machineType);
                    requiredPoints = occupiedHexes.length;
                  }
                  return currentActionPoints < requiredPoints;
                })()}
                className="flex-1 px-4 py-3 bg-green-500 text-white rounded hover:bg-green-600 font-bold disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                转为中立标记（消耗{(() => {
                  let requiredPoints = 1;
                  if (rendeKillConfirm.target.type === UnitType.BALLISTA || rendeKillConfirm.target.type === UnitType.CHARIOT) {
                    const machineType = rendeKillConfirm.target.type === UnitType.BALLISTA ? 'ballista' : 'chariot';
                    const occupiedHexes = getMachineOccupiedHexes(rendeKillConfirm.target.position, machineType);
                    requiredPoints = occupiedHexes.length;
                  }
                  return requiredPoints;
                })()}点）
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
