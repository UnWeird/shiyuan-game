import React, { useState, useMemo, useEffect, useRef } from 'react';
import { UnitType, Direction, GamePhase, Player } from '../../types';
import type { Unit, HexCoord } from '../../types';
import { useGameStore } from '../../stores/gameStore';
import { useIsNarrowScreen, useHasSideRail } from '../../hooks/useMobile';
import { HexMap } from '../Map/HexMap';
import { UnitPiece } from '../Unit/UnitPiece';
import { BattleLog } from '../UI/BattleLog';
import { LegendPanel } from '../UI/LegendPanel';
import RulesModal from '../UI/RulesModal';
import { hexEquals, hexToPixel, generateHexMap, isInStartZone, getShootingPath, getFanShapedHexes, getMachineOccupiedHexes, hexDistance, hexNeighbors, getDistanceToBaseline } from '../../utils/hexUtils';
import { colyseusService } from '../../services/ColyseusService';
import { toast, askConfirm, useUIStore } from '../../stores/uiStore';
import { IMPERIAL, UNIT_NAME } from '../../theme/boardTheme';
import { pendingAction, usePendingStore } from '../../game/pendingAction';
import { getServerAttackHexes, getServerAttackTargets, getServerLethalTargets, getServerMoves, useValidActionsStore } from '../../game/validActions';
import { playSfx } from '../../audio/sfx';

interface BattleLogEntry {
  id: string;
  message: string;
  type: 'move' | 'attack' | 'deploy' | 'kill' | 'info' | 'ability';
  timestamp: number;
}

// 辅助函数：判断是否是机关单位
const isMachineUnit = (unitType: UnitType): boolean => {
  return unitType === UnitType.BALLISTA || unitType === UnitType.CHARIOT || unitType === UnitType.CATAPULT;
};

/** 将领 id → 显示名。原来是一串 4 层三元表达式，在 HUD 里写了两遍 */
const GENERAL_NAME: Record<string, string> = {
  wushuang: '无双',
  shenji: '神机',
  rende: '仁德',
  taiping: '太平',
};

// 辅助函数：获取机关单位类型字符串
const getMachineTypeStr = (unitType: UnitType): 'ballista' | 'chariot' | 'catapult' | null => {
  if (unitType === UnitType.BALLISTA) return 'ballista';
  if (unitType === UnitType.CHARIOT) return 'chariot';
  if (unitType === UnitType.CATAPULT) return 'catapult';
  return null;
};

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
    player1ConsumedStock,
    player2ConsumedStock,
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
    addActionPoints,
    isOnlineMode,
    myPlayerRole,
    // 扇形攻击状态（在线模式使用服务器同步的状态）
    wushuangFanAttackActive: storeWushuangFanAttackActive,
    wushuangAttackingPlayer: storeWushuangAttackingPlayer,
    wushuangAttackPhase: storeWushuangAttackPhase,
    wushuangSelectedDirection: storeWushuangSelectedDirection,
    wushuangDiceRolls: storeWushuangDiceRolls,
    // 太平将军状态
    player1DestinyValue,
    player2DestinyValue,
    taipingFushuiActive,
    taipingFushuiPlayer,
    taipingTianmingActive,
    taipingTianmingCangtiandi,
    taipingTianmingHuangtian,
    taipingTianmingDamage,
    taipingTianmingOldDestiny,
    taipingSharedHp,
    taipingSharedMaxHp,
    player1DoufanUsedThisTurn,
    player2DoufanUsedThisTurn,
    player1TaipingDeployInitDone,
    player2TaipingDeployInitDone,
    // 太平将军单机模式行动
    taipingFushuiConvert: storeTaipingFushuiConvert,
    taipingDoufan: storeTaipingDoufan,
    taipingTianmingRoll: storeTaipingTianmingRoll,
    taipingDeployInit: storeTaipingDeployInit,
  } = useGameStore();

  // selectedUnit / currentActionPoints 原来由 useGameActions 派生。
  // 那个 hook 是客户端自己的规则引擎（2024 行），单机改走服务端后已无用，整体删除，
  // 这两个派生值直接从 store 算即可。
  const selectedUnit = selectedUnitId ? units[selectedUnitId] : null;
  const currentActionPoints = currentPlayer === Player.PLAYER1 ? player1ActionPoints : player2ActionPoints;

  const isRulesModalOpen = useGameStore(state => state.isRulesModalOpen);
  const setRulesModalOpen = useGameStore(state => state.setRulesModalOpen);
  const soundEnabled = useUIStore(state => state.soundEnabled);
  const toggleSound = useUIStore(state => state.toggleSound);

  // 「指令已发出、等服务端确认」状态：用于幽灵棋子与压暗原棋子
  const pending = usePendingStore(state => state.pending);
  const rejectedUnitId = usePendingStore(state => state.rejectedUnitId);

  // 服务端权威战报（在线模式显示这份，而不是本地猜的那份）
  const serverBattleLog = useGameStore(state => state.serverBattleLog);

  const [highlightedHexes, setHighlightedHexes] = useState<HexCoord[]>([]);
  const [actionMode, setActionMode] = useState<'move' | 'attack' | 'deploy' | 'rotate' | 'rende-convert' | 'rende-neutral' | null>(null);
  const [deployUnitType, setDeployUnitType] = useState<UnitType | null>(null);
  const [battleLogs, setBattleLogs] = useState<BattleLogEntry[]>([]);
  const [rotationPaths, setRotationPaths] = useState<Map<Direction, HexCoord[]>>(new Map());
  const [shenjiAbilityActive, setShenjiAbilityActive] = useState(false);
  const [selectedDiceIndex, setSelectedDiceIndex] = useState<number | null>(null);
  const [rerollMode, setRerollMode] = useState(false);
  const [pendingRendeSkill, setPendingRendeSkill] = useState<'convert' | 'neutral' | null>(null);

  /* 两个纯客户端的反馈动画。
   * animations.css 里 @keyframes dice-roll 与 turn-flash 一直写好却没有任何组件引用 ——
   * 骰子是直接蹦出最终点数，回合切换也没有任何提示。两者都不需要服务端配合。 */
  const [diceRolling, setDiceRolling] = useState(false);
  const [turnFlash, setTurnFlash] = useState(false);

  // 移动端检测
  // 窄屏布局：只看视口宽度，不看设备类型
  const isNarrow = useIsNarrowScreen();
  /* 摆不摆得下右侧栏，是和 isNarrow 不同的一个断点（1024）。
   * 820×1180 这类视口 isNarrow=false 但侧栏放不下，见 docs/layout-spec.md §3.4 */
  const hasSideRail = useHasSideRail();

  /**
   * 威胁区与方阵盾是在 **render 期间**读的，所以必须订阅 store。
   *
   * 其余 getServer* 是不订阅的普通函数 —— 它们只在事件处理里调用（点「移动」时取一次
   * 落点），那里拿当次最新值就够了。但 render 期间用不订阅的 getter 会漏更新：
   * validActions 到达时若没有别的状态同时变化，组件不会重渲染，威胁区就会晚一帧。
   */
  const enemyThreatHexes = useValidActionsStore(state => state.threatHexes);
  const depthDefended = useValidActionsStore(state => state.depthDefended);
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

  /**
   * 骰子投出 → 转一圈。
   *
   * 用骰子结果的"内容"做依赖而不是长度：重掷（神机改点数 / rerollMode）时
   * 颗数不变但点数变了，也应该转一圈。
   */
  const diceSignature = (currentPlayer === Player.PLAYER1 ? player1DiceResults : player2DiceResults)
    .join(',');
  useEffect(() => {
    if (!diceSignature) return;
    setDiceRolling(true);
    const t = setTimeout(() => setDiceRolling(false), 600);
    return () => clearTimeout(t);
  }, [diceSignature]);

  /** 回合切换 → HUD 闪一下，告诉玩家"该换人了" */
  useEffect(() => {
    setTurnFlash(true);
    const t = setTimeout(() => setTurnFlash(false), 500);
    return () => clearTimeout(t);
  }, [currentPlayer]);

  // 处理待激活的仁德技能（在选中仁德后自动激活）
  useEffect(() => {
    if (!pendingRendeSkill || !selectedUnit) return;

    // 确保选中的是仁德将军
    if (selectedUnit.type !== UnitType.GENERAL) {
      setPendingRendeSkill(null);
      return;
    }

    // 在需要时获取最新的 units（而不是依赖它）
    const currentUnits = useGameStore.getState().units;

    // 激活对应的技能
    if (pendingRendeSkill === 'convert') {
      // 转化接触单位
      const adjacentHexes = hexNeighbors(selectedUnit.position);
      const adjacentUnits: Unit[] = [];

      Object.values(currentUnits).forEach(u => {
        if (u.id === selectedUnit.id || u.owner === selectedUnit.owner) return;

        if (isMachineUnit(u.type)) {
          const machineType = getMachineTypeStr(u.type)!;
          const isPlayerOne = u.owner === Player.PLAYER1;
          const occupiedHexes = getMachineOccupiedHexes(u.position, machineType, isPlayerOne);
          const isAdjacent = occupiedHexes.some(hex =>
            adjacentHexes.some(adjHex => hexEquals(adjHex, hex))
          );
          if (isAdjacent && !adjacentUnits.find(au => au.id === u.id)) {
            adjacentUnits.push(u);
          }
        } else {
          const isAdjacent = adjacentHexes.some(hex => hexEquals(hex, u.position));
          if (isAdjacent) {
            adjacentUnits.push(u);
          }
        }
      });

      setHighlightedHexes(adjacentUnits.map(u => u.position));
      setActionMode('rende-convert');
    } else if (pendingRendeSkill === 'neutral') {
      // 转化中立标记
      const neutralMarkers = Object.values(currentUnits)
        .filter(u =>
          u.type === UnitType.NEUTRAL_MARKER &&
          u.owner === Player.NEUTRAL &&
          hexDistance(selectedUnit.position, u.position) === 1
        );

      setHighlightedHexes(neutralMarkers.map(u => u.position));
      setActionMode('rende-neutral');
    }

    // 清除待激活状态
    setPendingRendeSkill(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRendeSkill, selectedUnit]);


  // 判断是否是自己的回合
  const isMyTurn = !isOnlineMode ||
    (myPlayerRole === 'player1' && currentPlayer === Player.PLAYER1) ||
    (myPlayerRole === 'player2' && currentPlayer === Player.PLAYER2);

  // 添加战斗日志（仅单机模式使用；在线模式的战报由服务端下发）
  const addLog = (message: string, type: BattleLogEntry['type']) => {
    setBattleLogs(prev => [...prev, {
      id: `${Date.now()}-${Math.random()}`,
      message,
      type,
      timestamp: Date.now(),
    }]);
  };

  /**
   * 发出在线指令前登记「待确认」，让界面立刻给出反馈。
   * 只记录请求内容，不在本地重演规则。
   */
  const beginPending = (
    kind: 'move' | 'attack',
    unit: Unit,
    target: HexCoord,
    targetUnit?: Unit
  ) => {
    pendingAction.begin({
      kind,
      unitId: unit.id,
      target,
      targetUnitId: targetUnit?.id,
      fromPosition: unit.position,
      actionsBefore: unit.actionsThisTurn,
      targetHpBefore: targetUnit?.hp,
    });
  };

  // 指令落定/回滚后收尾：落定就清掉选中，被拒绝时保留选中方便改主意重选
  const prevPendingRef = useRef(pending);
  useEffect(() => {
    if (prevPendingRef.current && !pending) {
      if (!usePendingStore.getState().rejectedUnitId) {
        selectUnit(null);
        setHighlightedHexes([]);
      }
    }
    prevPendingRef.current = pending;
  }, [pending, selectUnit]);

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

  // 计算剩余可用库存（基于 剩余 = 上限 - 已消耗）
  const remainingCounts = useMemo(() => {
    const army = currentPlayer === Player.PLAYER1 ? player1Army : player2Army;
    const consumedStock = currentPlayer === Player.PLAYER1
      ? player1ConsumedStock
      : player2ConsumedStock;

    // 在线模式和单机模式都使用 consumedStock 来计算剩余库存
    // consumedStock 是永久消耗，不会因单位死亡而减少
    if (consumedStock) {
      return {
        infantry: army.infantry - (consumedStock.infantry || 0),
        cavalry: army.cavalry - (consumedStock.cavalry || 0),
        archer: army.archer - (consumedStock.archer || 0),
        general: 1 - Object.values(units).filter(u => u.owner === currentPlayer && u.type === UnitType.GENERAL).length,
      };
    }

    // 兜底：如果 consumedStock 未定义（不应该发生），使用场上数量
    const myUnits = Object.values(units).filter(u => u.owner === currentPlayer);
    return {
      infantry: army.infantry - myUnits.filter(u => u.type === UnitType.INFANTRY).length,
      cavalry: army.cavalry - myUnits.filter(u => u.type === UnitType.CAVALRY).length,
      archer: army.archer - myUnits.filter(u => u.type === UnitType.ARCHER).length,
      general: 1 - myUnits.filter(u => u.type === UnitType.GENERAL).length,
    };
  }, [units, currentPlayer, player1Army, player2Army, player1ConsumedStock, player2ConsumedStock, isOnlineMode]);

  // 获取当前玩家的配置
  const army = currentPlayer === Player.PLAYER1 ? player1Army : player2Army;

  // 开始部署阶段时掷骰子
  const handleRollDice = () => {
    playSfx('dice');
    if (isOnlineMode) {
      // 在线模式：发送给服务器
      colyseusService.rollDice();
    }
  };

  // 选中单位
  const handleUnitClick = (unitId: string) => {
    const unit = units[unitId];
    const myPlayer = isOnlineMode && myPlayerRole
      ? (myPlayerRole === 'player1' ? Player.PLAYER1 : Player.PLAYER2)
      : currentPlayer;
    const isMine = unit.owner === myPlayer;

    /**
     * 点敌方棋子时转发成「点它所在的格子」。
     *
     * 棋子的圆盘正好盖住格心，而攻击/转化这类操作的落点判定在格子层
     * （棋子层在格子热区之上）。原来点敌人直接 return，玩家必须瞄准格子
     * **边缘**那一圈才点得到 —— 实测要偏移约 0.38 个格高才命中。
     * 现在落点交给 handleHexClick，它内部已有完整的合法性判断。
     */
    if (!isMine) {
      const targetingModes = ['attack', 'rende-convert', 'rende-neutral', 'rotate'];
      if (actionMode && targetingModes.includes(actionMode)) {
        handleHexClick(unit.position);
      }
      return;
    }

    playSfx('select');
    selectUnit(unitId);
    setActionMode(null);

    // 如果是机关单位，高亮其所有占用的格子
    if (isMachineUnit(unit.type)) {
      const machineTypeStr = getMachineTypeStr(unit.type)!;
      const isPlayerOne = unit.owner === Player.PLAYER1;
      const occupiedHexes = getMachineOccupiedHexes(unit.position, machineTypeStr, isPlayerOne);
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
      if (isMachineUnit(deployUnitType)) {
        // 在线模式：发送部署机关单位命令到服务器
        const machineType = getMachineTypeStr(deployUnitType)!;
        playSfx('place');
        colyseusService.shenjiDeployMachine(machineType, hex);

        const unitName = deployUnitType === UnitType.BALLISTA ? '弩车' :
                        deployUnitType === UnitType.CHARIOT ? '战车' : '投石车';
        addLog(`部署了${unitName}`, 'deploy');

        // 部署成功后退出部署模式
        setActionMode(null);
        setDeployUnitType(null);
        setHighlightedHexes([]);
        return;
      }

      // 普通单位部署
      playSfx('place');
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


    if (actionMode === 'rotate') {
      // 点击射击路径选择方向
      handleRotationPathClick(hex);
      return;
    }

    // 仁德技能：转化接触单位
    if (actionMode === 'rende-convert' && selectedUnit) {
      const target = Object.values(units).find(u => {
        // 检查是否是机关单位
        if (isMachineUnit(u.type)) {
          const machineType = getMachineTypeStr(u.type)!;
          const isPlayerOne = u.owner === Player.PLAYER1;
          const occupiedHexes = getMachineOccupiedHexes(u.position, machineType, isPlayerOne);
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
        }
      }
      return;
    }

    // 如果没有选中单位且不在特殊模式，点击格子可能是要选择机关单位
    if (!selectedUnit && !actionMode) {
      const unit = Object.values(units).find(u => {
        if (u.owner !== currentPlayer) return false;
        // 检查是否是机关单位
        if (isMachineUnit(u.type)) {
          const machineType = getMachineTypeStr(u.type)!;
          const isPlayerOne = u.owner === Player.PLAYER1;
          const occupiedHexes = getMachineOccupiedHexes(u.position, machineType, isPlayerOne);
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
          // 在线模式：发指令 + 记为「待确认」。
          // 不写战报（战报由服务端权威日志同步下来），
          // 也不取消选中 —— 保留选中作为视觉锚点，落定后再清。
          playSfx('move');
          beginPending('move', selectedUnit, hex);
          colyseusService.moveUnit(selectedUnit.id, hex);
          setActionMode(null);
          setHighlightedHexes([]);
        }
      } else {
        // 普通移动
        if (isOnlineMode) {
          playSfx('move');
          beginPending('move', selectedUnit, hex);
          colyseusService.moveUnit(selectedUnit.id, hex);
          setActionMode(null);
          setHighlightedHexes([]);
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
            if (isMachineUnit(u.type)) {
              const machineType = getMachineTypeStr(u.type)!;
              const isPlayerOne = u.owner === Player.PLAYER1;
              const occupiedHexes = getMachineOccupiedHexes(u.position, machineType, isPlayerOne);
              return occupiedHexes.some(occupiedHex => hexEquals(occupiedHex, hex));
            }
            // 普通单位只检查中心位置
            return hexEquals(u.position, hex);
          });

          if (target) {
            if (isOnlineMode) {
              // 在线模式：发指令 + 记为待确认，战报交给服务端
              playSfx('attack');
              beginPending('attack', selectedUnit, hex, target);
              colyseusService.ballistaMeleeAttack(selectedUnit.id, target.id);
            }
            setActionMode(null);
            setHighlightedHexes([]);
            selectUnit(null);
          }
        } else {
          // 贯穿攻击
          if (isOnlineMode) {
            // 贯穿攻击命中谁由服务端决定，这里只记「原地动作待确认」
            playSfx('attack');
            beginPending('attack', selectedUnit, selectedUnit.position);
            colyseusService.ballistaPierceAttack(selectedUnit.id);
            setActionMode(null);
            setHighlightedHexes([]);
          }
        }
      } else {
        // 普通攻击 - 查找被点击位置的单位（包括机关占用的格子）
        const target = Object.values(units).find(u => {
          // 检查是否是机关单位
          if (isMachineUnit(u.type)) {
            const machineType = getMachineTypeStr(u.type)!;
            const isPlayerOne = u.owner === Player.PLAYER1;
            const occupiedHexes = getMachineOccupiedHexes(u.position, machineType, isPlayerOne);
            return occupiedHexes.some(occupiedHex => hexEquals(occupiedHex, hex));
          }
          // 普通单位只检查中心位置
          return hexEquals(u.position, hex);
        });

        if (target) {
          if (isOnlineMode) {
            // 在线模式：发指令 + 记为待确认
            // 注意：仁德将军的特殊逻辑目前不支持在线模式
            playSfx('attack');
            beginPending('attack', selectedUnit, hex, target);
            colyseusService.attackUnit(selectedUnit.id, target.id);
            setActionMode(null);
            setHighlightedHexes([]);
            selectUnit(null);
          }
        }
      }
    }
  };

  // 显示移动范围
  const handleShowMoves = () => {
    if (!selectedUnit) return;
    // 在线模式用服务端下发的合法落点：和服务端校验同一份判断，
    // 不会再出现「高亮了却被拒绝」。单机模式暂时仍用本地引擎（阶段 4 会一起删）。
    // 高亮只用服务端下发的合法落点（客户端那份规则实现已删除）
    const moves = getServerMoves(selectedUnit.id);
    setHighlightedHexes(moves);
    setActionMode('move');
  };

  // 显示攻击范围
  const handleShowAttacks = () => {
    if (!selectedUnit) return;

    // 弩车 / 投石车：范围型攻击，高亮由服务端下发
    //
    // 这两条线（弩车垂直贯穿、投石车沿朝向射击）原来由客户端自己算，
    // 而服务端那一侧根本没有射程判定 —— 实测投石车能隔着整张图打对角。
    // 现在服务端补上了规则，并把覆盖格和可攻击目标一起推下来，
    // 高亮与校验用的是同一套计算。
    if (selectedUnit.type === UnitType.BALLISTA || selectedUnit.type === UnitType.CATAPULT) {
      const rangeHexes = getServerAttackHexes(selectedUnit.id);
      const meleeTargets = getServerAttackTargets(selectedUnit.id)
        .map(id => units[id])
        .filter(Boolean)
        .map(u => u.position);
      setHighlightedHexes([...rangeHexes, ...meleeTargets]);
      setActionMode('attack');
      return;
    }

    // 其他单位的攻击范围处理
    // 对于近战单位（步兵、骑兵、将军），需要特殊处理机关单位的高亮
    if (selectedUnit.type === UnitType.INFANTRY ||
        selectedUnit.type === UnitType.CAVALRY ||
        selectedUnit.type === UnitType.GENERAL) {
      // 计算攻击者相邻的所有格子
      const adjacentHexes = hexNeighbors(selectedUnit.position);
      const highlightHexes: HexCoord[] = [];

      // 查找相邻格子上的所有敌方单位
      adjacentHexes.forEach(adjHex => {
        Object.values(units).forEach(u => {
          if (u.owner === selectedUnit.owner || u.id === selectedUnit.id) return;

          // 检查是否是机关单位
          if (isMachineUnit(u.type)) {
            const machineType = getMachineTypeStr(u.type)!;
            const isPlayerOne = u.owner === Player.PLAYER1;
            const occupiedHexes = getMachineOccupiedHexes(u.position, machineType, isPlayerOne);

            // 如果机关单位的任意占据格子与相邻格子重合，高亮机关单位的核心位置（主要棋子）
            if (occupiedHexes.some(hex => hexEquals(hex, adjHex))) {
              if (!highlightHexes.some(h => hexEquals(h, u.position))) {
                highlightHexes.push(u.position);  // 只高亮核心位置，不高亮所有占据格子
              }
            }
          } else {
            // 普通单位：检查中心位置
            if (hexEquals(u.position, adjHex)) {
              if (!highlightHexes.some(h => hexEquals(h, u.position))) {
                highlightHexes.push(u.position);
              }
            }
          }
        });
      });

      setHighlightedHexes(highlightHexes);
      setActionMode('attack');
      return;
    }

    // 弓箭手等其他单位
    // 在线模式：服务端下发的可攻击目标 id，转成它们的位置来高亮。
    // 和服务端 handleAttackUnit 共用 checkAttackLegality，所以点得中。
    const targetPositions = getServerAttackTargets(selectedUnit.id)
      .map(id => units[id])
      .filter(Boolean)
      .map(u => u.position);

    // 只高亮敌人的位置,不是整个范围
    setHighlightedHexes(targetPositions);
    setActionMode('attack');
  };

  // 开始部署模式
  const handleStartDeploy = (unitType: UnitType) => {
    setDeployUnitType(unitType);
    setActionMode('deploy');

    // 计算可部署区域 - 只能在己方起始区（底部三排）部署
    const allHexes = generateHexMap(5);
    const playerSide = currentPlayer === Player.PLAYER1 ? 'top' : 'bottom';

    const availableHexes = allHexes.filter(hex => {
      // 检查是否在己方起始区
      if (!isInStartZone(hex, playerSide)) {
        return false;
      }

      const occupied = Object.values(units).some(u => hexEquals(u.position, hex));

      // 机关单位占据多个格子，需要检查所有占据的格子
      if (isMachineUnit(unitType)) {
        const machineTypeStr = unitType === UnitType.BALLISTA ? 'ballista' :
                              unitType === UnitType.CHARIOT ? 'chariot' : 'catapult';
        const occupiedHexes = getMachineOccupiedHexes(hex, machineTypeStr, currentPlayer === Player.PLAYER1);

        // 检查机关单位的所有格子是否都未被占用
        const hasCollision = occupiedHexes.some(occupiedHex =>
          Object.values(units).some(u => hexEquals(u.position, occupiedHex))
        );

        return !occupied && !hasCollision;
      }

      // 普通单位可以部署在己方起始区任何未被占用的位置
      return !occupied;
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
    if (selectedUnit.type !== UnitType.ARCHER && selectedUnit.type !== UnitType.BALLISTA && selectedUnit.type !== UnitType.CATAPULT) return;

    // 计算所有6个方向的射击路径
    const paths = new Map<Direction, HexCoord[]>();

    // 计算射程范围
    let maxRange = 5; // 默认地图半径
    if (selectedUnit.type === UnitType.ARCHER) {
      // 弓箭手射程 = 3 + 到己方基线的距离
      const playerSide = selectedUnit.owner === Player.PLAYER1 ? 'top' : 'bottom';
      const distToBaseline = getDistanceToBaseline(selectedUnit.position, playerSide);
      maxRange = 3 + distToBaseline;
    } else if (selectedUnit.type === UnitType.CATAPULT) {
      // 投石车无射程限制，只受地图边界限制
      maxRange = 999;
    }

    // 获取阻挡位置（用于阻挡射击）
    const blockedPositions: HexCoord[] = [];

    if (selectedUnit.type === UnitType.CATAPULT) {
      // 投石车：只被敌方单位阻挡
      Object.values(units).forEach(u => {
        if (u.id === selectedUnit.id) return;
        if (u.owner !== selectedUnit.owner) {
          if (u.type === UnitType.BALLISTA || u.type === UnitType.CHARIOT || u.type === UnitType.CATAPULT) {
            const machineType = u.type === UnitType.BALLISTA ? 'ballista' :
                               u.type === UnitType.CHARIOT ? 'chariot' : 'catapult';
            const isPlayerOne = u.owner === Player.PLAYER1;
            const occupiedHexes = getMachineOccupiedHexes(u.position, machineType, isPlayerOne);
            blockedPositions.push(...occupiedHexes);
          } else {
            blockedPositions.push(u.position);
          }
        }
      });
    } else {
      // 弓箭手/弩车：只被敌方单位阻挡，友方的弩车和战车不阻挡射击
      Object.values(units).forEach(u => {
        if (u.id === selectedUnit.id) return;

        // 友方的弩车和战车不阻挡射击
        if (u.owner === selectedUnit.owner && (u.type === UnitType.BALLISTA || u.type === UnitType.CHARIOT)) {
          return;
        }

        // 敌方单位会阻挡
        if (u.owner !== selectedUnit.owner) {
          // 检查机关单位的所有占用格子
          if (u.type === UnitType.BALLISTA || u.type === UnitType.CHARIOT || u.type === UnitType.CATAPULT) {
            const machineType = u.type === UnitType.BALLISTA ? 'ballista' :
                               u.type === UnitType.CHARIOT ? 'chariot' : 'catapult';
            const isPlayerOne = u.owner === Player.PLAYER1;
            const occupiedHexes = getMachineOccupiedHexes(u.position, machineType, isPlayerOne);
            blockedPositions.push(...occupiedHexes);
          } else {
            blockedPositions.push(u.position);
          }
        }
      });
    }

    [
      Direction.EAST,
      Direction.NORTH_EAST,
      Direction.NORTH_WEST,
      Direction.WEST,
      Direction.SOUTH_WEST,
      Direction.SOUTH_EAST,
    ].forEach(dir => {
      // 获取该方向的射击路径（使用计算后的射程，会被阻挡）
      const path = getShootingPath(selectedUnit.position, dir, maxRange, blockedPositions);

      // 所有方向都添加，显示完整射程
      if (path.length > 0) {
        paths.set(dir, path);
      }
    });

    setRotationPaths(paths);
    setActionMode('rotate');

    // 高亮所有方向的射程路径
    const allPathHexes: HexCoord[] = [];
    paths.forEach(path => allPathHexes.push(...path));
    setHighlightedHexes(allPathHexes);
  };

  // 转向
  const handleRotate = (direction: Direction) => {
    if (!selectedUnit) return;
    if (isOnlineMode) {
      // 在线模式：发送旋转指令到服务器
      playSfx('rotate');
      colyseusService.rotateUnit(selectedUnit.id, direction);
      addLog(`${selectedUnit.type}转向`, 'info');
      setActionMode(null);
      setHighlightedHexes([]);
      setRotationPaths(new Map());
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

  // 认输
  const handleSurrender = async () => {
    if (!isOnlineMode) {
      toast.warn('单机模式不支持认输');
      return;
    }

    const confirmed = await askConfirm({
      title: '认输',
      message: '认输后本局立即判负，无法撤回。',
      confirmText: '确认认输',
      cancelText: '再想想',
      danger: true,
    });
    if (confirmed) {
      colyseusService.surrender();
    }
  };

  // 太平将军·符水粥：转化选中的残血步兵
  const handleTaipingFushuiConvert = (unitId: string) => {
    if (isOnlineMode) {
      colyseusService.taipingFushuiConvert(unitId);
    }
  };

  // 太平将军·豆饭
  const handleTaipingDoufan = () => {
    if (isOnlineMode) {
      colyseusService.taipingDoufan();
    }
  };

  // 太平将军·结算天命（骰子）
  const handleTaipingTianmingRoll = () => {
    if (isOnlineMode) {
      colyseusService.taipingTianmingRoll();
    }
  };

  // 太平将军·确认结束回合（天命结算后）
  const handleTaipingTianmingConfirm = () => {
    if (isOnlineMode) {
      colyseusService.taipingTianmingConfirm();
    }
    setActionMode(null);
    setHighlightedHexes([]);
    selectUnit(null);
  };

  // 太平将军·部署阶段天命初始化
  const handleTaipingDeployInit = () => {
    if (isOnlineMode) {
      colyseusService.taipingDeployInit();
    }
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

  // 检查是否已经部署过单位（如果部署过，即使行动点为0也应该继续显示正常界面，而不是"掷骰子开始"）
  const hasDeployed = Object.values(units).some(u => u.owner === currentPlayer);

  if (phase === GamePhase.DEPLOY && currentActionPoints === 0 && !hasRolled && !hasDeployed) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'radial-gradient(ellipse at 50% 30%, #2a0a00 0%, #0d0500 50%, #050200 100%)' }}>
        <div className="rounded-lg p-8 text-center" style={{ background: 'linear-gradient(180deg, rgba(26,10,0,0.95) 0%, rgba(13,5,0,0.98) 100%)', border: '1px solid rgba(201,162,39,0.3)', boxShadow: '0 0 60px rgba(201,162,39,0.12)' }}>
          <h2 className="font-ancient text-3xl tracking-widest mb-4" style={{ color: '#C9A227', textShadow: '0 0 20px rgba(201,162,39,0.4)' }}>
            {currentPlayer === Player.PLAYER1 ? '玩家 1' : '玩家 2'} 的回合
          </h2>
          {!isMyTurn && (
            <p className="font-chinese text-sm mb-4 gold-breathe" style={{ color: 'rgba(201,162,39,0.6)' }}>等待对手操作...</p>
          )}
          <button
            onClick={handleRollDice}
            disabled={!isMyTurn}
            className="px-8 py-4 rounded font-chinese tracking-widest text-lg"
            style={isMyTurn ? {
              border: '1px solid rgba(201,162,39,0.5)',
              color: '#E8C84A',
              background: 'linear-gradient(135deg, rgba(80,20,20,0.4) 0%, rgba(26,10,0,0.8) 100%)',
              cursor: 'pointer',
            } : {
              border: '1px solid rgba(201,162,39,0.15)',
              color: 'rgba(201,162,39,0.3)',
              background: 'rgba(13,5,0,0.5)',
              cursor: 'not-allowed',
            }}
          >
            掷骰子开始
          </button>
        </div>
      </div>
    );
  }

  return (
    /* 整页一屏，不滚动：根是 flex column，棋盘那一行 flex:1 吃掉剩余高度。
     * 原来是 min-h-screen + max-w-7xl —— 内容宽被锁在 1280，1920 和 1440 下
     * 棋盘像素完全相同（744×664），而且页面在 1440×900 下要滚 221px。
     * 见 docs/layout-spec.md §L1 §L4 §3.2 */
    <div
      className="h-screen p-3 md:p-4 flex flex-col overflow-hidden"
      style={{ background: 'radial-gradient(ellipse at 50% 30%, #1a0800 0%, #0d0500 60%, #050200 100%)' }}
    >
      <div className="w-full mx-auto flex flex-col flex-1 min-h-0 gap-3 md:gap-4">
        {/* 非你回合提示 */}
        {!isMyTurn && isOnlineMode && (
          <div className="rounded-lg p-3 text-center flex-none" style={{ border: '1px solid rgba(201,162,39,0.35)', background: 'rgba(13,5,0,0.7)' }}>
            <p className="font-chinese tracking-wider gold-breathe" style={{ color: 'rgba(245,230,200,0.7)' }}>
              等待对手操作...
            </p>
          </div>
        )}

        {/* 顶部信息栏 */}
        <div className={`rounded-lg px-3 py-2 md:px-4 flex-none${turnFlash ? ' turn-transition' : ''}`} style={{ background: 'linear-gradient(180deg, rgba(26,10,0,0.95) 0%, rgba(13,5,0,0.98) 100%)', border: '1px solid rgba(201,162,39,0.25)', boxShadow: '0 0 20px rgba(201,162,39,0.08)' }}>
          {/* 单行 HUD：每个子项都是一行高的盒子 + items-center，
            * 这样"所有元素共享一条中心线"由布局本身保证，而不是靠手调。
            * 旧实现里各块是 2–4 行的堆叠，七个元素落在五条不同的中心线上
            * （实测 cy：行动阶段 101 / 规则 85 / 部署价值 61 / 行动点 41 / 基础 94 / 结束回合 85），
            * 整条 HUD 吃掉 138px（手机上 236px = 29% 视口高）。
            * 见 docs/layout-spec.md §L5 §3.2 */}
          <div className="flex flex-wrap justify-between items-center gap-y-2 gap-x-3 sy-hud">
            <div className="flex items-center gap-2 md:gap-3 min-w-0">
              {/* 回合 + 阶段：同一行，阶段作为次要后缀 */}
              <h2 className={`${isNarrow ? 'text-base' : 'text-xl'} font-ancient tracking-wider whitespace-nowrap`} style={{ color: '#C9A227' }}>
                {currentPlayer === Player.PLAYER1 ? '玩家 1' : '玩家 2'} 的回合
                <span className="ml-2 text-xs font-chinese align-middle" style={{ color: 'rgba(201,162,39,0.45)' }}>
                  {phase === GamePhase.DEPLOY ? '部署' : '行动'}
                </span>
              </h2>

              {/* 将领：头像 + 名字同一行，阵营靠名字颜色区分，不再单独占一行 */}
              <div className="flex items-center gap-1.5 md:gap-2 pl-2 md:pl-3 shrink-0" style={{ borderLeft: '1px solid rgba(201,162,39,0.2)' }}>
                {([
                  { g: player1General, side: '朱红', nameColor: '#E8C84A', bg: 'rgba(201,162,39,0.08)', border: 'rgba(201,162,39,0.4)', ring: 'rgba(201,162,39,0.5)' },
                  { g: player2General, side: '青玉', nameColor: '#6FCFA4', bg: 'rgba(46,107,79,0.10)', border: 'rgba(63,138,102,0.4)', ring: 'rgba(63,138,102,0.5)' },
                ] as const).map((p, i) => (
                  <React.Fragment key={p.side}>
                    {i === 1 && <span className="font-ancient text-xs shrink-0" style={{ color: 'rgba(201,162,39,0.35)' }}>VS</span>}
                    <div
                      className="flex items-center gap-1.5 px-2 py-1 rounded shrink-0"
                      style={{ background: p.bg, border: `1px solid ${p.border}` }}
                      title={`${p.side} · ${GENERAL_NAME[p.g ?? ''] ?? '未知'}`}
                    >
                      <img
                        src={`/generals/${p.g}.svg`}
                        alt=""
                        className="w-5 h-5 md:w-6 md:h-6 rounded-full"
                        style={{ border: `1px solid ${p.ring}` }}
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                      <span className="text-xs font-chinese font-bold whitespace-nowrap" style={{ color: p.nameColor }}>
                        {GENERAL_NAME[p.g ?? ''] ?? '未知'}
                      </span>
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </div>

            {/* 这一组（规则/音效/部署价值/行动点/操作按钮）原来是 nowrap，
                窄屏下内容总宽超过容器又不能换行，就把整页撑出横向滚动条。
                允许换行后各块会自己排成多行。 */}
            <div className="flex flex-wrap items-center justify-end gap-3 md:gap-6">
              {/* 规则 / 音效：收成 32×32 的图标按钮。
                * 它们不是回合动作，不该占 HUD 的横向预算 —— 带文字时两个按钮要 124px，
                * 1024 宽下正是它们把 HUD 挤成两行。文字进 title（也是无障碍标签）。 */}
              <button
                onClick={() => setRulesModalOpen(true)}
                className="flex items-center justify-center w-8 h-8 rounded font-chinese transition-all shrink-0"
                style={{ border: '1px solid rgba(201,162,39,0.35)', color: '#C9A227', background: 'rgba(13,5,0,0.6)' }}
                title="查看游戏规则"
                aria-label="查看游戏规则"
                onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(201,162,39,0.7)')}
                onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(201,162,39,0.35)')}
              >
                <span className="text-sm leading-none">规</span>
              </button>

              <button
                onClick={toggleSound}
                className="flex items-center justify-center w-8 h-8 rounded font-chinese transition-all shrink-0"
                style={{
                  border: '1px solid rgba(201,162,39,0.35)',
                  color: soundEnabled ? '#C9A227' : 'rgba(201,162,39,0.35)',
                  background: 'rgba(13,5,0,0.6)',
                }}
                title={soundEnabled ? '关闭音效' : '开启音效'}
                aria-label={soundEnabled ? '关闭音效' : '开启音效'}
                onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(201,162,39,0.7)')}
                onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(201,162,39,0.35)')}
              >
                <span className="text-sm leading-none">{soundEnabled ? '音' : '静'}</span>
              </button>

              {/* 部署价值：label 与数值同一行。
                * 原来是「标签 / 数值 / 骰子颗数」三行堆叠，骰子颗数这类派生信息
                * 挪进 title，鼠标悬停可查，不占 HUD 高度。 */}
              <div
                className="flex items-baseline gap-1.5 shrink-0"
                title={phase === GamePhase.DEPLOY
                  ? (currentPlayer === Player.PLAYER2
                      ? `骰子 ${1 + Math.floor(player1DeployedValue)} 颗（基于对方部署价值）`
                      : '先手无限行动点')
                  : `骰子 ${1 + Math.floor((currentPlayer === Player.PLAYER1 ? player1DeployedValue : player2DeployedValue) / 2)} 颗`}
              >
                <span className="text-xs font-chinese whitespace-nowrap" style={{ color: 'rgba(201,162,39,0.5)' }}>部署</span>
                <span className={`${isNarrow ? 'text-base' : 'text-lg'} font-ancient leading-none`} style={{ color: '#E8C84A' }}>
                  {(currentPlayer === Player.PLAYER1 ? player1DeployedValue : player2DeployedValue).toFixed(1)}元
                </span>
              </div>

              <div className="flex items-baseline gap-1.5 shrink-0">
                <span className="text-xs font-chinese whitespace-nowrap" style={{ color: 'rgba(201,162,39,0.5)' }}>行动点</span>
                {(() => {
                  const tempMax = currentPlayer === Player.PLAYER1 ? player1TempMaxActionPoints : player2TempMaxActionPoints;
                  const diceSum = (currentPlayer === Player.PLAYER1 ? player1DiceResults : player2DiceResults)
                    .reduce((sum, val) => sum + val, 0);

                  if (tempMax !== null) {
                    // 有临时上限,显示为 (当前/临时上限)
                    return (
                      <span className={`${isNarrow ? 'text-lg' : 'text-xl'} font-ancient leading-none`} style={{ color: '#E8C84A' }}>
                        {currentActionPoints}
                        <span className="text-sm" style={{ color: 'rgba(201,162,39,0.45)' }}>/{tempMax}</span>
                      </span>
                    );
                  } else {
                    // 没有临时上限,显示为 (当前/骰子总和)
                    return (
                      <span className={`${isNarrow ? 'text-lg' : 'text-xl'} font-ancient leading-none`} style={{ color: '#E8C84A' }}>
                        {currentActionPoints}
                        <span className="text-sm" style={{ color: 'rgba(201,162,39,0.45)' }}>/{diceSum}</span>
                      </span>
                    );
                  }
                })()}
              </div>

              {/* 骰子：自成一个单行内联组。
                * 原来挂在「行动点」块下面，还顶着一行「基础:N个 / 击杀奖励 / 永久失去」说明，
                * 所以行动点那一组比别的元素高出 44px。说明文字挪进 title。 */}
              {(() => {
                  const diceResults = currentPlayer === Player.PLAYER1 ? player1DiceResults : player2DiceResults;
                  const killDice = currentPlayer === Player.PLAYER1 ? player1KillDice : player2KillDice;
                  const lostDice = currentPlayer === Player.PLAYER1 ? player1LostDice : player2LostDice;
                  const totalDice = currentPlayer === Player.PLAYER1 ? player1Dice : player2Dice;

                  if (diceResults && diceResults.length > 0) {
                    // 基础骰子数 = 总骰子数 - 击杀骰子数
                    const baseDice = totalDice - killDice;

                    const breakdown = [
                      `基础 ${baseDice} 个`,
                      killDice > 0 ? `击杀奖励 +${killDice} 个` : '',
                      lostDice > 0 ? `永久失去 ${lostDice} 个` : '',
                    ].filter(Boolean).join(' · ');

                    return (
                      <div className="flex items-center gap-1.5 shrink-0" title={breakdown}>
                        {/* 基础骰子 - 蓝色边框 */}
                        {diceResults.slice(0, baseDice).map((result, index) => (
                          <span
                            key={`base-${index}`}
                            onClick={() => handleDiceClick(index, currentPlayer)}
                            className={`inline-flex items-center justify-center w-8 h-8 border-2 rounded-md text-sm font-bold shadow-sm transition-all ${
                              diceRolling ? 'dice-rolling' : ''
                            } ${
                              shenjiAbilityActive || rerollMode ? 'cursor-pointer hover:scale-110' : ''
                            } ${
                              selectedDiceIndex === index ? 'border-bronze scale-110' : rerollMode ? 'border-imperial-gold' : 'border-imperial-jade'
                            }`}
                          style={{ background: selectedDiceIndex === index ? 'rgba(120,0,200,0.25)' : 'rgba(13,5,0,0.8)', color: '#E8C84A' }}
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
                              className={`inline-flex items-center justify-center w-8 h-8 border-2 rounded-md text-sm font-bold shadow-sm transition-all ${
                                diceRolling ? 'dice-rolling' : ''
                              } ${
                                shenjiAbilityActive || rerollMode ? 'cursor-pointer hover:scale-110' : ''
                              } ${
                                selectedDiceIndex === actualIndex ? 'border-bronze scale-110' : rerollMode ? 'border-imperial-gold' : 'border-imperial-gold'
                              }`}
                              style={{ background: selectedDiceIndex === actualIndex ? 'rgba(120,0,200,0.25)' : 'rgba(13,5,0,0.8)', color: '#E8C84A' }}
                            >
                              {result}
                            </span>
                          );
                        })}
                        {/* 失去的骰子 - 灰色边框，无数字 */}
                        {Array.from({ length: lostDice }).map((_, index) => (
                          <span
                            key={`lost-${index}`}
                            className="inline-flex items-center justify-center w-8 h-8 border-2 border-imperial-gold-dark rounded-md text-sm font-bold opacity-40 shadow-sm"
                            style={{ background: 'rgba(13,5,0,0.5)', color: 'rgba(201,162,39,0.3)' }}
                          >
                            ✕
                          </span>
                        ))}
                      </div>
                    );
                  }
                  return null;
                })()}
              {/* 太平将军天命结算结果面板 */}
              {(() => {
                const currentGeneral = currentPlayer === Player.PLAYER1 ? player1General : player2General;
                const isTaipingTurn = currentGeneral === 'taiping' && isMyTurn;
                if (!isTaipingTurn || !taipingTianmingActive) return null;
                const currentDestiny = currentPlayer === Player.PLAYER1 ? player1DestinyValue : player2DestinyValue;
                return (
                  <div className="mb-3 p-3 rounded-lg" style={{ background: 'rgba(13,5,0,0.6)', border: '1px solid rgba(201,162,39,0.4)' }}>
                    <h4 className="text-sm font-chinese font-bold mb-2" style={{ color: '#C9A227' }}>天命结算结果</h4>
                    <div className="text-xs space-y-1 font-chinese" style={{ color: 'rgba(245,230,200,0.7)' }}>
                      <div className="flex justify-between">
                        <span>苍天骰：</span><span className="font-bold text-imperial-jade-light">{taipingTianmingCangtiandi}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>黄天骰：</span><span className="font-bold text-imperial-gold-light">{taipingTianmingHuangtian}</span>
                      </div>
                      <div className="flex justify-between pt-1" style={{ borderTop: '1px solid rgba(201,162,39,0.2)' }}>
                        <span>天命值：</span>
                        <span className="font-bold">{taipingTianmingOldDestiny} + {taipingTianmingHuangtian} - {taipingTianmingCangtiandi} = <span className="text-bronze-light">{currentDestiny}</span></span>
                      </div>
                      <div className="flex justify-between">
                        <span>承载伤害：</span>
                        <span className={`font-bold ${taipingTianmingDamage > 0 ? 'text-imperial-red-light' : 'text-imperial-jade-light'}`}>
                          {taipingTianmingDamage > 0 ? `扣${taipingTianmingDamage}血（力士过多）` : '无伤害'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* 窄屏下让这排操作按钮独占一行：
                  和信息块挤在同一行时会被压到换行（「结\束\回\合」）或撑出横向滚动条 */}
              <div className={isNarrow ? "flex gap-2 w-full" : "flex gap-3"}>
                {/* 部署阶段太平将军：苍天已死黄天当立初始化按钮 */}
                {phase === GamePhase.DEPLOY && isMyTurn && (() => {
                  const hasTaiping = currentPlayer === Player.PLAYER1
                    ? player1General === 'taiping'
                    : player2General === 'taiping';
                  const initDone = currentPlayer === Player.PLAYER1
                    ? player1TaipingDeployInitDone
                    : player2TaipingDeployInitDone;
                  if (!hasTaiping) return null;
                  return (
                    <div className="w-full mb-2">
                      {!initDone ? (
                        <button
                          onClick={handleTaipingDeployInit}
 className="btn-sy btn-sy-gold w-full px-6 py-3 rounded-lg font-bold whitespace-nowrap"
                        >
                          ⚡ 结算天命值（苍天已死，黄天当立）
                        </button>
                      ) : (
                        <p className="text-center text-sm panel-sy-title font-bold">✅ 初始天命已结算（+3点）</p>
                      )}
                    </div>
                  );
                })()}

                {/* 太平将军：结算天命按钮 or 正常结束回合 */}
                {(() => {
                  const currentGeneral = currentPlayer === Player.PLAYER1 ? player1General : player2General;
                  const isTaipingTurn = currentGeneral === 'taiping' && isMyTurn && phase !== GamePhase.DEPLOY;
                  const taipingAlive = Object.values(units).some(u =>
                    u.owner === currentPlayer && u.type === UnitType.GENERAL && (u as any).generalType === 'taiping'
                  );

                  if (isTaipingTurn && taipingAlive && !taipingTianmingActive) {
                    // 未结算天命：显示「结算天命」按钮
                    return (
                      <button
                        onClick={handleTaipingTianmingRoll}
                        disabled={taipingFushuiActive && taipingFushuiPlayer === currentPlayer}
 className="btn-sy btn-sy-gold flex-1 px-6 py-3 rounded-lg font-bold whitespace-nowrap"
                      >
                        结算天命
                      </button>
                    );
                  } else if (isTaipingTurn && taipingAlive && taipingTianmingActive) {
                    // 已结算天命：显示「结束回合」确认按钮
                    return (
                      <button
                        onClick={handleTaipingTianmingConfirm}
 className="btn-sy btn-sy-red flex-1 px-6 py-3 rounded-lg font-bold whitespace-nowrap"
                      >
                        结束回合
                      </button>
                    );
                  } else {
                    // 非太平将军或将军已死：正常结束回合
                    return (
                      <button
                        onClick={handleEndTurn}
                        disabled={!isMyTurn}
                        className="btn-sy btn-sy-red flex-1 px-6 py-3 rounded-lg font-bold whitespace-nowrap"
                      >
                        结束回合
                      </button>
                    );
                  }
                })()}
                {isOnlineMode && (
                  <button
                    onClick={handleSurrender}
 className="btn-sy btn-sy-ghost px-6 py-3 rounded-lg font-bold whitespace-nowrap"
                  >
                    认输
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div
          className={hasSideRail ? "flex gap-4 flex-1 min-h-0" : "flex flex-col gap-3 flex-1 min-h-0"}
        >
          {/* 棋盘区
           *
           * 尺寸公式见 docs/layout-spec.md §3.1：容器量自身尺寸（container-type: size），
           * 棋盘取 min(可用宽, 可用高 × 长宽比)，既吃满空间又永不溢出。
           * 旧实现是宽屏固定 height:700px、窄屏 aspectRatio '9.66/8.5' + maxHeight 62vh，
           * 前者让棋盘在任何宽度下都一样大，后者的比值还和真实 viewBox 不符。 */}
          <div
            className={hasSideRail
              ? "sy-board-wrap rounded-lg p-2 md:p-3 flex-1 min-h-0 min-w-0"
              : "sy-board-wrap sy-board-wrap--width rounded-lg p-2 flex-none min-w-0"}
            style={{
              touchAction: 'none', // 防止移动端滚动干扰
              background: 'rgba(13,5,0,0.6)',
              border: '1px solid rgba(201,162,39,0.2)',
            }}
          >
            <div className="sy-board">
              <HexMap
                radius={5}
                hexSize={isNarrow ? 30 : 40}
                onHexClick={handleHexClick}
                highlightedHexes={highlightedHexes}
                /* 攻击类的高亮走朱色，移动走青色。
                 * 原来两者共用同一套填充，攻击范围显示成"可移动"的青色，是实打实的误导。 */
                highlightKind={actionMode === 'attack' || actionMode === 'rende-convert' ? 'attack' : 'move'}
                /* 范围内真有敌军的格子加深 + 挂矛尖。
                 * 「可攻击 vs 可击杀」（空心/实心矛尖）要等服务端下发 lethal，见 §7 */
                threatHexes={
                  actionMode === 'attack'
                    ? highlightedHexes.filter(h =>
                        Object.values(units).some(u =>
                          u.owner !== currentPlayer && hexEquals(u.position, h)))
                    : []
                }
                /* 实心矛尖 = 这一下能杀。lethal 由服务端用与实际结算同一份
                 * Rules.predictDamage 算出来，客户端不自己判血量。 */
                lethalHexes={
                  actionMode === 'attack' && selectedUnit
                    ? getServerLethalTargets(selectedUnit.id)
                        .map(id => units[id]?.position)
                        .filter((p): p is HexCoord => !!p)
                    : []
                }
                /* 敌方下回合能打到的格子：常驻铺朱色斜纹，让站位失误在落子前就看得见。
                 * 由服务端委派 checkAttackLegality 算出，不含战车碾压 → 偏保守。 */
                enemyThreatHexes={enemyThreatHexes}
                /* 被纵深抗击保护的单位：队首亮盾。
                 * 这条规则（弓箭手打步兵、背后有连续步兵则免伤）谁都发现不了，
                 * 画出来等于把一条隐藏规则变成一种可用的玩法。 */
                shieldedHexes={Object.values(units)
                  .filter(un => depthDefended.has(un.id))
                  .map(un => un.position)}
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
                        const pixel = hexToPixel(hex, isNarrow ? 30 : 40);
                        return (
                          <circle
                            key={`${hex.q}-${hex.r}-${hex.s}`}
                            cx={pixel.x}
                            cy={pixel.y}
                            r={isNarrow ? 11 : 15}
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
              {Object.values(units).filter(u => u.type === UnitType.BALLISTA || u.type === UnitType.CHARIOT || u.type === UnitType.CATAPULT).map(unit => {
                const hexSize = isNarrow ? 30 : 40;
                const machineTypeStr = unit.type === UnitType.BALLISTA ? 'ballista' : unit.type === UnitType.CHARIOT ? 'chariot' : 'catapult';
                const isPlayerOne = unit.owner === Player.PLAYER1;
                const occupiedHexes = getMachineOccupiedHexes(unit.position, machineTypeStr, isPlayerOne);

                return (
                  // pointerEvents none：以前外层 svg 整体不收事件，现在棋子和热区同在一个
                  // SVG 里，这层装饰若不让开就会挡住它覆盖的格子
                  <g key={`machine-${unit.id}`} opacity={0.3} pointerEvents="none">
                    {/* 渲染除中心位置外的所有占用格子 */}
                    {occupiedHexes.slice(1).map((hex, index) => {
                      const pixel = hexToPixel(hex, hexSize);
                      return (
                        <circle
                          key={`${unit.id}-hex-${index}`}
                          cx={pixel.x}
                          cy={pixel.y}
                          r={isNarrow ? 9 : 12}
                          fill={unit.owner === Player.PLAYER1 ? IMPERIAL.redLight : '#3F8A66'}
                          className="machine-hex-indicator"
                        />
                      );
                    })}
                  </g>
                );
              })}

              {Object.values(units).map(unit => {
                /* 棋子上的「移动力下弧」与「已行动」都从服务端下发的 validActions 推出，
                 * 不在客户端按兵种硬编码一张移动力表 —— 那份数值住在服务端，两边会漂移。
                 * 见 docs/board-art-spec.md §7 */
                const moves = getServerMoves(unit.id);
                const moveSteps = moves.length
                  ? Math.max(...moves.map(m => m.steps ?? 1))
                  : undefined;
                const hasAttack =
                  getServerAttackTargets(unit.id).length > 0 ||
                  getServerAttackHexes(unit.id).length > 0;
                return (
                  <g key={unit.id} style={{ pointerEvents: 'auto' }}>
                    <UnitPiece
                      unit={unit}
                      hexSize={isNarrow ? 30 : 40}
                      onClick={() => handleUnitClick(unit.id)}
                      isSelected={unit.id === selectedUnitId}
                      isPending={pending?.unitId === unit.id}
                      isRejected={rejectedUnitId === unit.id}
                      moveSteps={moveSteps}
                      isSpent={unit.actionsThisTurn > 0 && !moveSteps && !hasAttack}
                    />
                  </g>
                );
              })}

              {/* 移动指令待确认：在目标格画半透明幽灵棋子，点下去就有反应 */}
              {pending?.kind === 'move' && units[pending.unitId] && (
                <UnitPiece
                  unit={{ ...units[pending.unitId], position: pending.target }}
                  hexSize={isNarrow ? 30 : 40}
                  isGhost
                />
              )}

              {/* 攻击指令待确认：目标格上画朱红脉冲环 */}
              {pending?.kind === 'attack' && (() => {
                const c = hexToPixel(pending.target, isNarrow ? 30 : 40);
                return (
                  <circle
                    className="attack-pending-ring"
                    cx={c.x}
                    cy={c.y}
                    r={(isNarrow ? 30 : 40) * 0.55}
                    fill="none"
                    stroke={IMPERIAL.redLight}
                    strokeWidth={3}
                    strokeDasharray="6 4"
                  />
                );
              })()}
              </HexMap>
            </div>
          </div>

          {/* 右侧操作面板
           * 旧实现是 maxHeight:700px + overflow-y-auto —— 820×1180 这类高视口下
           * 视口有 1180 高、面板却硬截到 700，将军技能按钮被切掉一半，要在面板内二次滚动。
           * 现在跟着行高走，内部自己滚。见 docs/layout-spec.md §L6 */}
          <div
            className="space-y-3 overflow-y-auto min-h-0"
            style={hasSideRail
              ? { flex: '0 0 clamp(264px, 22%, 400px)' }
              // 堆叠时：棋盘按宽度定高后，剩下的高度全给操作面板，面板自己滚
              : { flex: '1 1 auto' }}
          >
            {/* 选中单位信息 */}
            {selectedUnit && (
              <div className="rounded-lg p-4" style={{ background: 'rgba(13,5,0,0.7)', border: '1px solid rgba(201,162,39,0.2)' }}>
                <h3 className="text-lg font-ancient tracking-wider mb-2" style={{ color: '#C9A227' }}>选中单位</h3>
                <div className="space-y-2">
                  {/* 这三行原来没有任何颜色类，继承浏览器默认 rgb(0,0,0)，
                    * 写在 rgba(13,5,0,0.7) 的面板上实测对比度 1.04:1（AA 要求 4.5:1），
                    * 等于不可见；而且「类型」直接把枚举值 archer / general 显示给玩家。
                    * 见 docs/layout-spec.md §6 验收项 8 */}
                  <p style={{ color: 'rgba(245,230,200,0.85)' }}>
                    <strong style={{ color: 'rgba(201,162,39,0.85)' }}>类型:</strong>{' '}
                    {UNIT_NAME[selectedUnit.type] ?? selectedUnit.type}
                  </p>
                  <p style={{ color: 'rgba(245,230,200,0.85)' }}>
                    <strong style={{ color: 'rgba(201,162,39,0.85)' }}>生命:</strong>{' '}
                    {selectedUnit.hp}/{selectedUnit.maxHp}
                  </p>
                  <p style={{ color: 'rgba(245,230,200,0.85)' }}>
                    <strong style={{ color: 'rgba(201,162,39,0.85)' }}>行动:</strong>{' '}
                    {selectedUnit.actionsThisTurn}/
                    {(() => {
                      // 弩车特殊处理：行动次数上限为1
                      if (selectedUnit.type === UnitType.BALLISTA) {
                        return 1;
                      }
                      // 战车特殊处理：行动次数上限为1
                      if (selectedUnit.type === UnitType.CHARIOT) {
                        return 1;
                      }
                      // 投石车特殊处理：行动次数上限为1
                      if (selectedUnit.type === UnitType.CATAPULT) {
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
                    disabled={
                      !isMyTurn ||
                      currentActionPoints < 1 ||
                      ('cannotMoveNextTurn' in selectedUnit && selectedUnit.cannotMoveNextTurn === true) ||
                      (() => {
                        // 部署阶段：玩家1不能移动，玩家2可以移动
                        if (phase === GamePhase.DEPLOY && currentPlayer === Player.PLAYER1) return true;

                        // 弓兵特殊处理：行动次数上限为2
                        if (selectedUnit.type === UnitType.ARCHER) {
                          // 达到行动次数上限
                          if (selectedUnit.actionsThisTurn >= 2) return true;
                          // 已经移动过（即使还有行动次数也不能再移动）
                          if (selectedUnit.hasMoved) return true;
                          return false;
                        }

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

                        // 投石车特殊处理：行动次数上限为1
                        if (selectedUnit.type === UnitType.CATAPULT) {
                          // 只检查hasActedThisTurn，因为投石车每回合只能行动一次
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
                      })()
                    }
 className="btn-sy btn-sy-jade w-full px-4 py-2 rounded-lg text-sm font-semibold"
                  >
                    移动 {!isMyTurn ? '(非你的回合)' : ('cannotMoveNextTurn' in selectedUnit && selectedUnit.cannotMoveNextTurn) ? '(被定身)' : phase === GamePhase.DEPLOY && currentPlayer === Player.PLAYER1 ? '(部署阶段不可用)' : ''}
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
 className="btn-sy btn-sy-red w-full px-4 py-2 rounded-lg text-sm font-bold"
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
                        <div className="mt-3 p-3 panel-sy rounded-lg">
                          <h4 className="text-sm font-bold mb-2 panel-sy-title">扇形攻击进行中</h4>

                          {/* 第一阶段：选择方向 */}
                          {wushuangAttackPhase === 'select-direction' && (
                            <div className="space-y-2">
                              <p className="text-xs panel-sy-text text-center">
                                选择攻击方向（120°扇形，消耗3点行动值）
                              </p>

                              {/* 方向选择器 */}
                              <div className="relative" style={{ height: '120px' }}>
                                <button onClick={() => handleWushuangSelectDirection(Direction.NORTH_WEST)}
                                  className={`absolute left-1 top-1 px-2 py-1 text-xs rounded font-semibold transition-all ${
                                    wushuangSelectedDirection === Direction.NORTH_WEST
                                      ? 'btn-sy-dir btn-sy-dir-on'
                                      : 'btn-sy-dir'
                                  }`}>
                                  ↖
                                </button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.NORTH_EAST)}
                                  className={`absolute right-1 top-1 px-2 py-1 text-xs rounded font-semibold transition-all ${
                                    wushuangSelectedDirection === Direction.NORTH_EAST
                                      ? 'btn-sy-dir btn-sy-dir-on'
                                      : 'btn-sy-dir'
                                  }`}>
                                  ↗
                                </button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.WEST)}
                                  className={`absolute left-1 top-1/2 -translate-y-1/2 px-2 py-1 text-xs rounded font-semibold transition-all ${
                                    wushuangSelectedDirection === Direction.WEST
                                      ? 'btn-sy-dir btn-sy-dir-on'
                                      : 'btn-sy-dir'
                                  }`}>
                                  ←
                                </button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.EAST)}
                                  className={`absolute right-1 top-1/2 -translate-y-1/2 px-2 py-1 text-xs rounded font-semibold transition-all ${
                                    wushuangSelectedDirection === Direction.EAST
                                      ? 'btn-sy-dir btn-sy-dir-on'
                                      : 'btn-sy-dir'
                                  }`}>
                                  →
                                </button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.SOUTH_WEST)}
                                  className={`absolute left-1 bottom-1 px-2 py-1 text-xs rounded font-semibold transition-all ${
                                    wushuangSelectedDirection === Direction.SOUTH_WEST
                                      ? 'btn-sy-dir btn-sy-dir-on'
                                      : 'btn-sy-dir'
                                  }`}>
                                  ↙
                                </button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.SOUTH_EAST)}
                                  className={`absolute right-1 bottom-1 px-2 py-1 text-xs rounded font-semibold transition-all ${
                                    wushuangSelectedDirection === Direction.SOUTH_EAST
                                      ? 'btn-sy-dir btn-sy-dir-on'
                                      : 'btn-sy-dir'
                                  }`}>
                                  ↘
                                </button>
                              </div>

                              <div className="flex gap-2">
                                <button
                                  onClick={executeWushuangFanAttack}
                                  disabled={wushuangSelectedDirection === null}
                                  className="flex-1 px-2 py-1 btn-sy btn-sy-gold rounded text-xs"
                                >
                                  确认攻击
                                </button>
                                <button
                                  onClick={cancelWushuangFanAttack}
                                  className="px-2 py-1 btn-sy btn-sy-ghost rounded text-xs"
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          )}

                          {/* 第二阶段：消耗2点行动值掷骰 */}
                          {wushuangAttackPhase === 'second-roll' && (
                            <div className="space-y-2">
                              <div className="p-2 rounded" style={{ background: 'rgba(200,80,0,0.1)', border: '1px solid rgba(200,80,0,0.3)' }}>
                                <p className="text-xs font-bold text-imperial-gold">✓ 第一次攻击完成</p>
                                {wushuangDiceRolls.length > 0 && (
                                  <div className="flex items-center gap-1 mt-1">
                                    <span className="text-xs" style={{ color: 'rgba(201,162,39,0.5)' }}>已掷骰：</span>
                                    {wushuangDiceRolls.map((roll, i) => (
                                      <span key={i} className="inline-flex items-center justify-center w-6 h-6 border-2 border-imperial-gold rounded text-xs font-bold text-imperial-gold" style={{ background: 'rgba(13,5,0,0.8)' }}>
                                        {roll}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                <p className="text-xs panel-sy-title mt-1">
                                  消耗<span className="font-bold">2点</span>掷骰，≤2可再攻击
                                </p>
                                {currentActionPoints < 2 && (
                                  <p className="text-xs text-imperial-red-light mt-1 font-semibold">
                                    ⚠️ 行动值不足
                                  </p>
                                )}
                              </div>

                              <div className="flex gap-2">
                                <button
                                  onClick={executeWushuangSecondRoll}
                                  disabled={currentActionPoints < 2 || wushuangDiceRolls.length > 0}
                                  className="flex-1 px-2 py-1 btn-sy btn-sy-jade rounded text-xs"
                                >
                                  {wushuangDiceRolls.length > 0 ? '已掷骰' : (currentActionPoints < 2 ? '行动值不足' : '掷骰(消耗2点)')}
                                </button>
                                <button
                                  onClick={cancelWushuangFanAttack}
                                  className="px-2 py-1 btn-sy btn-sy-ghost rounded text-xs"
                                >
                                  结束
                                </button>
                              </div>
                            </div>
                          )}

                          {/* 第二阶段：选择第二次攻击方向 */}
                          {wushuangAttackPhase === 'second-attack' && (
                            <div className="space-y-2">
                              <p className="text-xs panel-sy-text text-center">
                                选择第二次攻击方向
                              </p>

                              <div className="relative" style={{ height: '120px' }}>
                                <button onClick={() => handleWushuangSelectDirection(Direction.NORTH_WEST)}
                                  className={`absolute left-1 top-1 px-2 py-1 text-xs rounded font-semibold transition-all ${wushuangSelectedDirection === Direction.NORTH_WEST ? 'btn-sy-dir btn-sy-dir-on' : 'btn-sy-dir'}`}>↖</button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.NORTH_EAST)}
                                  className={`absolute right-1 top-1 px-2 py-1 text-xs rounded font-semibold transition-all ${wushuangSelectedDirection === Direction.NORTH_EAST ? 'btn-sy-dir btn-sy-dir-on' : 'btn-sy-dir'}`}>↗</button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.WEST)}
                                  className={`absolute left-1 top-1/2 -translate-y-1/2 px-2 py-1 text-xs rounded font-semibold transition-all ${wushuangSelectedDirection === Direction.WEST ? 'btn-sy-dir btn-sy-dir-on' : 'btn-sy-dir'}`}>←</button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.EAST)}
                                  className={`absolute right-1 top-1/2 -translate-y-1/2 px-2 py-1 text-xs rounded font-semibold transition-all ${wushuangSelectedDirection === Direction.EAST ? 'btn-sy-dir btn-sy-dir-on' : 'btn-sy-dir'}`}>→</button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.SOUTH_WEST)}
                                  className={`absolute left-1 bottom-1 px-2 py-1 text-xs rounded font-semibold transition-all ${wushuangSelectedDirection === Direction.SOUTH_WEST ? 'btn-sy-dir btn-sy-dir-on' : 'btn-sy-dir'}`}>↙</button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.SOUTH_EAST)}
                                  className={`absolute right-1 bottom-1 px-2 py-1 text-xs rounded font-semibold transition-all ${wushuangSelectedDirection === Direction.SOUTH_EAST ? 'btn-sy-dir btn-sy-dir-on' : 'btn-sy-dir'}`}>↘</button>
                              </div>

                              <div className="flex gap-2">
                                <button
                                  onClick={executeSecondFanAttack}
                                  disabled={wushuangSelectedDirection === null}
                                  className="flex-1 px-2 py-1 btn-sy btn-sy-gold rounded text-xs"
                                >
                                  确认第二次攻击
                                </button>
                                <button
                                  onClick={cancelWushuangFanAttack}
                                  className="px-2 py-1 btn-sy btn-sy-ghost rounded text-xs"
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          )}

                          {/* 第三阶段：消耗1点行动值掷骰 */}
                          {wushuangAttackPhase === 'third-roll' && (
                            <div className="space-y-2">
                              <div className="p-2 rounded" style={{ background: 'rgba(200,80,0,0.1)', border: '1px solid rgba(200,80,0,0.3)' }}>
                                <p className="text-xs font-bold text-imperial-gold">✓ 第二阶段完成</p>
                                {wushuangDiceRolls.length > 0 && (
                                  <div className="flex items-center gap-1 mt-1">
                                    <span className="text-xs" style={{ color: 'rgba(201,162,39,0.5)' }}>之前：</span>
                                    {wushuangDiceRolls.map((roll, i) => (
                                      <span key={i} className="inline-flex items-center justify-center w-5 h-5 border-2 border-imperial-gold rounded text-xs font-bold text-imperial-gold" style={{ background: 'rgba(13,5,0,0.8)' }}>
                                        {roll}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                <p className="text-xs panel-sy-title mt-1">
                                  消耗<span className="font-bold">1点</span>掷骰，=1可再攻击
                                </p>
                              </div>

                              <div className="flex gap-2">
                                <button
                                  onClick={executeWushuangThirdRoll}
                                  disabled={currentActionPoints < 1 || wushuangDiceRolls.length > 1}
                                  className="flex-1 px-2 py-1 btn-sy btn-sy-bronze rounded text-xs"
                                >
                                  {wushuangDiceRolls.length > 1 ? '已掷骰' : (currentActionPoints < 1 ? '行动值不足' : '掷骰(消耗1点)')}
                                </button>
                                <button
                                  onClick={cancelWushuangFanAttack}
                                  className="px-2 py-1 btn-sy btn-sy-ghost rounded text-xs"
                                >
                                  结束
                                </button>
                              </div>
                            </div>
                          )}

                          {/* 第三阶段：选择第三次攻击方向 */}
                          {wushuangAttackPhase === 'third-attack' && (
                            <div className="space-y-2">
                              <p className="text-xs panel-sy-text text-center">
                                选择第三次攻击方向
                              </p>

                              <div className="relative" style={{ height: '120px' }}>
                                <button onClick={() => handleWushuangSelectDirection(Direction.NORTH_WEST)}
                                  className={`absolute left-1 top-1 px-2 py-1 text-xs rounded font-semibold transition-all ${wushuangSelectedDirection === Direction.NORTH_WEST ? 'btn-sy-dir btn-sy-dir-on' : 'btn-sy-dir'}`}>↖</button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.NORTH_EAST)}
                                  className={`absolute right-1 top-1 px-2 py-1 text-xs rounded font-semibold transition-all ${wushuangSelectedDirection === Direction.NORTH_EAST ? 'btn-sy-dir btn-sy-dir-on' : 'btn-sy-dir'}`}>↗</button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.WEST)}
                                  className={`absolute left-1 top-1/2 -translate-y-1/2 px-2 py-1 text-xs rounded font-semibold transition-all ${wushuangSelectedDirection === Direction.WEST ? 'btn-sy-dir btn-sy-dir-on' : 'btn-sy-dir'}`}>←</button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.EAST)}
                                  className={`absolute right-1 top-1/2 -translate-y-1/2 px-2 py-1 text-xs rounded font-semibold transition-all ${wushuangSelectedDirection === Direction.EAST ? 'btn-sy-dir btn-sy-dir-on' : 'btn-sy-dir'}`}>→</button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.SOUTH_WEST)}
                                  className={`absolute left-1 bottom-1 px-2 py-1 text-xs rounded font-semibold transition-all ${wushuangSelectedDirection === Direction.SOUTH_WEST ? 'btn-sy-dir btn-sy-dir-on' : 'btn-sy-dir'}`}>↙</button>
                                <button onClick={() => handleWushuangSelectDirection(Direction.SOUTH_EAST)}
                                  className={`absolute right-1 bottom-1 px-2 py-1 text-xs rounded font-semibold transition-all ${wushuangSelectedDirection === Direction.SOUTH_EAST ? 'btn-sy-dir btn-sy-dir-on' : 'btn-sy-dir'}`}>↘</button>
                              </div>

                              <div className="flex gap-2">
                                <button
                                  onClick={executeThirdFanAttack}
                                  disabled={wushuangSelectedDirection === null}
                                  className="flex-1 px-2 py-1 btn-sy btn-sy-gold rounded text-xs"
                                >
                                  确认第三次攻击
                                </button>
                                <button
                                  onClick={cancelWushuangFanAttack}
                                  className="px-2 py-1 btn-sy btn-sy-ghost rounded text-xs"
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
                          // 贯穿路径由服务端下发，与校验同一套计算
                          setHighlightedHexes(getServerAttackHexes(selectedUnit.id));
                          setActionMode('attack');
                        }}
                        disabled={!isMyTurn || phase === GamePhase.DEPLOY || ('hasActedThisTurn' in selectedUnit && (selectedUnit as any).hasActedThisTurn) || selectedUnit.actionsThisTurn >= 1}
 className="btn-sy btn-sy-red w-full px-4 py-2 rounded-lg text-sm"
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
                              if (isMachineUnit(u.type)) {
                                const machineType = getMachineTypeStr(u.type)!;
                                const isPlayerOne = u.owner === Player.PLAYER1;
                                const occupiedHexes = getMachineOccupiedHexes(u.position, machineType, isPlayerOne);
                                return occupiedHexes.some(hex => hexEquals(hex, neighborHex));
                              }

                              return false;
                            });
                          });

                          setHighlightedHexes(enemyTargets);
                          setActionMode('attack');
                        }}
                        disabled={!isMyTurn || phase === GamePhase.DEPLOY || ('hasActedThisTurn' in selectedUnit && (selectedUnit as any).hasActedThisTurn) || selectedUnit.actionsThisTurn >= 1}
 className="btn-sy btn-sy-red w-full px-4 py-2 rounded-lg text-sm"
                      >
                        近战攻击 {!isMyTurn ? '(非你的回合)' : phase === GamePhase.DEPLOY ? '(部署阶段不可攻击)' : ''}
                      </button>
                    </div>
                  ) : selectedUnit.type === UnitType.CHARIOT ? (
                    /* 战车：只能移动碾压，没有攻击按钮 */
                    <div className="text-sm text-imperial-parchment-dark text-center py-2">
                      战车通过移动碾压敌人
                    </div>
                  ) : selectedUnit.type === UnitType.CATAPULT ? (
                    /* 投石车：转向、蓄力、攻击 */
                    <div className="space-y-2">
                      {/* 蓄力按钮 */}
                      <button
                        onClick={() => {
                          if (!selectedUnit) return;
                          // 蓄力逻辑：增加蓄力层数（最多2层）
                          if (isOnlineMode) {
                            colyseusService.catapultCharge(selectedUnit.id);
                            addLog('投石车蓄力', 'ability');
                          }
                        }}
                        disabled={!isMyTurn || currentActionPoints < 1 || phase === GamePhase.DEPLOY || ('hasActedThisTurn' in selectedUnit && (selectedUnit as any).hasActedThisTurn) || selectedUnit.actionsThisTurn >= 1 || ((selectedUnit as any).chargeLevel >= 2)}
 className="btn-sy btn-sy-gold btn-sy-ability w-full px-4 py-2 rounded-lg text-sm"
                      >
                        蓄力 {`(${(selectedUnit as any).chargeLevel || 0}/2)`} {!isMyTurn ? '(非你的回合)' : ''}
                      </button>
                      {/* 攻击按钮 */}
                      <button
                        onClick={() => {
                          if (!selectedUnit) return;
                          // 射击路径由服务端下发，与校验同一套计算
                          setHighlightedHexes(getServerAttackHexes(selectedUnit.id));
                          setActionMode('attack');
                        }}
                        disabled={!isMyTurn || phase === GamePhase.DEPLOY || ('hasActedThisTurn' in selectedUnit && (selectedUnit as any).hasActedThisTurn) || selectedUnit.actionsThisTurn >= 1}
 className="btn-sy btn-sy-red w-full px-4 py-2 rounded-lg text-sm"
                      >
                        投射攻击 {`(蓄力${(selectedUnit as any).chargeLevel || 0}层)`} {!isMyTurn ? '(非你的回合)' : phase === GamePhase.DEPLOY ? '(部署阶段不可攻击)' : ''}
                      </button>
                      {/* 转向按钮 */}
                      <button
                        onClick={handleShowRotation}
                        disabled={
                          !isMyTurn ||
                          phase === GamePhase.DEPLOY ||
                          ('hasActedThisTurn' in selectedUnit && (selectedUnit as any).hasActedThisTurn) ||
                          selectedUnit.actionsThisTurn >= 1 ||
                          ('cannotRotateNextTurn' in selectedUnit && selectedUnit.cannotRotateNextTurn === true)
                        }
 className="btn-sy btn-sy-bronze w-full px-4 py-2 rounded-lg text-sm"
                      >
                        转向 {!isMyTurn ? '(非你的回合)' : ('cannotRotateNextTurn' in selectedUnit && selectedUnit.cannotRotateNextTurn) ? '(被定身)' : phase === GamePhase.DEPLOY ? '(部署阶段不可用)' : ''}
                      </button>
                    </div>
                  ) : (
                    /* 其他单位：普通攻击 */
                    <button
                      onClick={handleShowAttacks}
                      disabled={!isMyTurn || currentActionPoints < 1 || phase === GamePhase.DEPLOY || selectedUnit.hasAttacked || selectedUnit.actionsThisTurn >= 2}
 className="btn-sy btn-sy-red w-full px-4 py-2 rounded-lg text-sm"
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
                        currentActionPoints < 1 ||
                        selectedUnit.actionsThisTurn >= 2 ||
                        ('cannotRotateNextTurn' in selectedUnit && selectedUnit.cannotRotateNextTurn === true)
                      }
 className="btn-sy btn-sy-gold w-full px-4 py-2 rounded-lg text-sm"
                    >
                      {actionMode === 'rotate' ? '选择射击方向' : '转向 (显示射程)'}
                      {!isMyTurn
                        ? ' (非你的回合)'
                        : ('cannotRotateNextTurn' in selectedUnit && selectedUnit.cannotRotateNextTurn)
                          ? ' (被定身)'
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

            {/* 部署面板
              *
              * 中局补兵是**真机制**（handleStartDeploy 由行动点闸控），所以行动阶段不能把它藏掉。
              * 改成可折叠：部署阶段默认展开，行动阶段默认收起并在标题上带剩余兵力摘要；
              * 全部兵力部署完就整块不渲染。既不占右栏高度，也没动功能。 */}
            {(remainingCounts.general + remainingCounts.infantry + remainingCounts.cavalry + remainingCounts.archer > 0) && (
            <details
              className="rounded-lg p-4 sy-collapse"
              open={phase === GamePhase.DEPLOY || actionMode === 'deploy'}
              style={{ background: 'rgba(13,5,0,0.7)', border: '1px solid rgba(201,162,39,0.2)' }}
            >
              <summary className="cursor-pointer list-none flex items-baseline gap-2">
                <span className="text-lg font-ancient tracking-wider" style={{ color: '#C9A227' }}>部署单位</span>
                <span className="text-xs font-chinese" style={{ color: 'rgba(201,162,39,0.45)' }}>
                  {actionMode === 'deploy'
                    ? '点击起始区放置'
                    : [
                        remainingCounts.general > 0 ? `将${remainingCounts.general}` : '',
                        remainingCounts.infantry > 0 ? `步${remainingCounts.infantry}` : '',
                        remainingCounts.cavalry > 0 ? `骑${remainingCounts.cavalry}` : '',
                        remainingCounts.archer > 0 ? `弓${remainingCounts.archer}` : '',
                      ].filter(Boolean).join(' · ')}
                </span>
              </summary>
              <div className="mt-3">

              {actionMode === 'deploy' && (
                <button
                  onClick={handleCancelDeploy}
 className="btn-sy btn-sy-ghost w-full px-4 py-2 mb-3 rounded-lg text-sm font-semibold"
                >
                  取消部署
                </button>
              )}

              <div className="space-y-2">
                {/* 将军按钮 - 优先推荐 */}
                <button
 className="btn-sy btn-sy-gold w-full px-4 py-2 rounded-lg text-sm font-bold relative overflow-hidden"
                  onClick={() => handleStartDeploy(UnitType.GENERAL)}
                  disabled={!isMyTurn || remainingCounts.general <= 0 || currentActionPoints < 1}
                >
                  {remainingCounts.general > 0 && (
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
                  )}
                  <div className="relative">
                    将军 ({remainingCounts.general}/1) {!isMyTurn ? '(非你的回合)' : ''}
                  </div>
                </button>

                <button
 className="btn-sy btn-sy-jade w-full px-4 py-2 rounded-lg text-sm font-semibold"
                  onClick={() => handleStartDeploy(UnitType.INFANTRY)}
                  disabled={!isMyTurn || remainingCounts.infantry <= 0 || currentActionPoints < 1}
                >
                  步兵 ({remainingCounts.infantry}/{army.infantry}) {!isMyTurn ? '(非你的回合)' : ''}
                </button>
                <button
 className="btn-sy btn-sy-jade w-full px-4 py-2 rounded-lg text-sm font-semibold"
                  onClick={() => handleStartDeploy(UnitType.CAVALRY)}
                  disabled={!isMyTurn || remainingCounts.cavalry <= 0 || currentActionPoints < 1}
                >
                  骑兵 ({remainingCounts.cavalry}/{army.cavalry}) {!isMyTurn ? '(非你的回合)' : ''}
                </button>
                <button
 className="btn-sy btn-sy-jade w-full px-4 py-2 rounded-lg text-sm font-semibold"
                  onClick={() => handleStartDeploy(UnitType.ARCHER)}
                  disabled={!isMyTurn || remainingCounts.archer <= 0 || currentActionPoints < 1}
                >
                  弓箭手 ({remainingCounts.archer}/{army.archer}) {!isMyTurn ? '(非你的回合)' : ''}
                </button>
              </div>
              </div>
            </details>
            )}

            {/* 将军技能面板 */}
            {(() => {
              const currentGeneral = currentPlayer === Player.PLAYER1 ? player1General : player2General;
              const generalUnit = Object.values(units).find(u =>
                u.owner === currentPlayer && u.type === UnitType.GENERAL
              );

              if (!currentGeneral || !generalUnit) return null;

              return (
                <div className="rounded-lg p-4" style={{ background: 'rgba(13,5,0,0.7)', border: '1px solid rgba(201,162,39,0.2)' }}>
                  <h3 className="text-lg font-ancient tracking-wider mb-2" style={{ color: '#C9A227' }}>将军技能</h3>

                  {/* 神机技能 */}
                  {currentGeneral === 'shenji' && (
                    <>
                      {/* 部署机关区域 */}
                      <div className="mb-4 p-3 rounded-lg" style={{ background: 'rgba(60,0,90,0.2)', border: '1px solid rgba(150,0,220,0.3)' }}>
                        <h4 className="text-sm font-chinese font-bold mb-2" style={{ color: 'rgba(180,100,255,0.9)' }}>部署机关单位</h4>
                        <div className="space-y-2">
                          <button
 className="btn-sy btn-sy-bronze w-full px-4 py-2 rounded-lg text-sm font-bold"
                            onClick={() => handleStartDeploy(UnitType.BALLISTA)}
                            disabled={!isMyTurn || currentActionPoints < 3}
                          >
                            弩车 (2步+1弓) - 3点 {!isMyTurn ? '(非你的回合)' : ''}
                          </button>
                          <button
 className="btn-sy btn-sy-bronze w-full px-4 py-2 rounded-lg text-sm font-bold"
                            onClick={() => handleStartDeploy(UnitType.CHARIOT)}
                            disabled={!isMyTurn || currentActionPoints < 4}
                          >
                            战车 (4步) - 4点 {!isMyTurn ? '(非你的回合)' : ''}
                          </button>
                          <button
 className="btn-sy btn-sy-bronze w-full px-4 py-2 rounded-lg text-sm font-bold"
                            onClick={() => handleStartDeploy(UnitType.CATAPULT)}
                            disabled={!isMyTurn || currentActionPoints < 3}
                          >
                            投石车 (2步+1弓) - 3点 {!isMyTurn ? '(非你的回合)' : ''}
                          </button>

                        </div>
                      </div>

                      {/* 神机技能区域 */}
                      <div className="mb-4 p-3 panel-sy rounded-lg">
                        <h4 className="text-sm font-bold panel-sy-title mb-2">神机技能</h4>

                        {/* 被动技能：改骰 */}
                        {!shenjiAbilityActive && (
                          <button
                            onClick={handleShenjiAbility}
                            disabled={!isMyTurn}
 className="btn-sy btn-sy-gold btn-sy-ability w-full px-4 py-2 rounded-lg text-sm font-bold"
                          >
                            修改骰子 {!isMyTurn ? '(非你的回合)' : ''}
                          </button>
                        )}

                        {shenjiAbilityActive && (
                          <div className="space-y-2">
                            <p className="text-xs text-imperial-gold font-semibold">
                              {selectedDiceIndex !== null ? '选择新的点数（1-6）' : '点击要修改的骰子'}
                            </p>

                            {selectedDiceIndex !== null ? (
                              <div className="grid grid-cols-3 gap-2">
                                {[1, 2, 3, 4, 5, 6].map(value => (
                                  <button
                                    key={value}
                                    onClick={() => handleModifyDice(value)}
 className="btn-sy btn-sy-gold px-3 py-2 rounded-lg text-sm font-bold"
                                  >
                                    {value}
                                  </button>
                                ))}
                              </div>
                            ) : null}

                            <button
                              onClick={cancelShenjiAbility}
 className="btn-sy btn-sy-ghost w-full px-4 py-2 rounded-lg text-sm"
                            >
                              取消
                            </button>
                          </div>
                        )}

                        {('abilityUsed' in generalUnit && generalUnit.abilityUsed) ? (
                          <p className="text-xs text-imperial-parchment-dark italic mt-2">技能已使用</p>
                        ) : null}
                      </div>

                      {/* 机关崩毁重投次数 */}
                      {(() => {
                        const rerollTokens = currentPlayer === Player.PLAYER1 ? player1RerollTokens : player2RerollTokens;
                        return (
                          <div className="p-3 panel-sy rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-bold panel-sy-title">机关崩毁奖励</span>
                              <span className="text-xs panel-sy panel-sy-text px-2 py-1 rounded font-bold">
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
                                className="w-full px-4 py-2 btn-sy btn-sy-gold btn-sy-ability rounded text-sm"
                              >
                                重投骰子 {!isMyTurn ? '(非你的回合)' : ''}
                              </button>
                            )}
                            {rerollMode && (
                              <div className="space-y-2">
                                <p className="text-xs text-imperial-gold font-semibold">
                                  点击要重投的骰子
                                </p>
                                <button
                                  onClick={() => {
                                    setRerollMode(false);
                                    addLog('取消重投', 'info');
                                  }}
 className="btn-sy btn-sy-ghost w-full px-4 py-2 rounded-lg text-sm"
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
                    <div className="p-3 panel-sy rounded-lg">
                      <h4 className="text-sm font-bold panel-sy-title mb-2">无双技能</h4>

                      {/* 一次性技能：获得已损失体力值的行动值 */}
                      {!('abilityUsed' in generalUnit && generalUnit.abilityUsed) ? (
                        <button
                          onClick={handleWushuangInvincibility}
                          disabled={!isMyTurn}
 className="btn-sy btn-sy-gold btn-sy-ability w-full px-4 py-2 rounded-lg text-sm font-bold"
                        >
                          获得已损失体力值的行动值 {!isMyTurn ? '(非你的回合)' : ''}
                        </button>
                      ) : (
                        <p className="text-xs text-imperial-parchment-dark italic">一次性技能已使用</p>
                      )}
                    </div>
                  )}

                  {/* 太平将军技能 */}
                  {currentGeneral === 'taiping' && (
                    <div className="p-3 rounded-lg" style={{ background: 'rgba(13,5,0,0.6)', border: '1px solid rgba(201,162,39,0.35)' }}>
                      <h4 className="text-sm font-chinese font-bold mb-2" style={{ color: '#C9A227' }}>太平技能</h4>

                      {/* 天命值显示 */}
                      {((): React.ReactNode => {
                        const bothTaiping = player1General === 'taiping' && player2General === 'taiping';
                        const destinyVal = currentPlayer === Player.PLAYER1 ? player1DestinyValue : player2DestinyValue;
                        const lishiCount = Object.values(units).filter((u: any) =>
                          u.type === UnitType.HUANGJIN_LISHI && (bothTaiping || u.owner === currentPlayer)
                        ).length;
                        const zeiCount = Object.values(units).filter((u: any) => u.type === UnitType.HUANGJIN_ZEI).length;
                        const doufanUsed = currentPlayer === Player.PLAYER1 ? player1DoufanUsedThisTurn : player2DoufanUsedThisTurn;
                        return (
                          <div className="mb-3 text-xs space-y-1 font-chinese rounded p-2" style={{ background: 'rgba(201,162,39,0.06)', color: 'rgba(245,230,200,0.7)' }}>
                            {bothTaiping && (
                              <div className="flex justify-between font-bold" style={{ color: 'rgba(255,140,60,0.9)' }}>
                                <span>共享血池：</span><span>{taipingSharedHp}/{taipingSharedMaxHp}</span>
                              </div>
                            )}
                            <div className="flex justify-between"><span>天命值：</span><span className="font-bold text-bronze-light">{destinyVal}</span></div>
                            <div className="flex justify-between"><span>黄巾力士：</span><span className="font-bold text-imperial-gold-light">{lishiCount}</span></div>
                            <div className="flex justify-between"><span>黄巾贼：</span><span className="font-bold text-imperial-red-light">{zeiCount}</span></div>
                            <div className="text-xs" style={{ color: 'rgba(201,162,39,0.4)' }}>{lishiCount > destinyVal ? '⚠️ 力士过多，回合结束将扣1血' : '✅ 承载正常'}</div>
                            {doufanUsed && <div className="text-xs text-imperial-gold">豆饭本回合已使用</div>}
                          </div>
                        );
                      })()}

                      {/* 豆饭主动技能 */}
                      {((): React.ReactNode => {
                        const doufanUsed = currentPlayer === Player.PLAYER1 ? player1DoufanUsedThisTurn : player2DoufanUsedThisTurn;
                        return (
                          <button
                            onClick={handleTaipingDoufan}
                            disabled={!isMyTurn || currentActionPoints < 3 || doufanUsed || (taipingFushuiActive && taipingFushuiPlayer === currentPlayer)}
 className="btn-sy btn-sy-gold btn-sy-ability w-full px-4 py-2 rounded-lg text-sm font-bold mb-2"
                          >
                            豆饭（3点→召唤d6黄巾力士）{doufanUsed ? ' [本回合已用]' : ''}{!isMyTurn ? '(非你的回合)' : ''}
                          </button>
                        );
                      })()}

                      {/* 符水粥提示 */}
                      {taipingFushuiActive && taipingFushuiPlayer === currentPlayer && (
                        <p className="text-xs text-imperial-gold font-semibold">
                          ⚠️ 符水粥模式进行中，请先完成转化
                        </p>
                      )}
                    </div>
                  )}

                  {/* 仁德技能 */}
                  {currentGeneral === 'rende' && (
                    <>
                      {/* 一次性技能：转化接触单位 */}
                      <div className="mb-4 p-3 panel-sy rounded-lg">
                        <h4 className="text-sm font-bold panel-sy-title mb-2">仁德技能（一次性）</h4>

                        {!('abilityUsed' in generalUnit && generalUnit.abilityUsed) ? (
                          <button
                            onClick={() => {
                              console.log('点击转化接触单位按钮');
                              console.log('generalUnit:', generalUnit);
                              console.log('generalUnit.id:', generalUnit.id);
                              // 设置待激活的技能并选中仁德
                              setPendingRendeSkill('convert');
                              selectUnit(generalUnit.id);
                              console.log('已设置 pendingRendeSkill=convert 和 selectUnit');
                            }}
                            disabled={!isMyTurn || currentActionPoints < 2}
                            className="w-full px-4 py-2 btn-sy btn-sy-gold btn-sy-ability rounded text-sm"
                          >
                            转化接触单位（2点） {!isMyTurn ? '(非你的回合)' : ''}
                          </button>
                        ) : (
                          <p className="text-xs text-imperial-parchment-dark italic">一次性技能已使用</p>
                        )}
                      </div>

                      {/* 转化为步兵技能（无限次） */}
                      <div className="p-3 panel-sy rounded-lg">
                        <h4 className="text-sm font-bold panel-sy-title mb-2">转化中立标记</h4>

                        {((): React.ReactNode => {
                          const convertCost = ('convertInfantryCost' in generalUnit && typeof generalUnit.convertInfantryCost === 'number')
                            ? generalUnit.convertInfantryCost
                            : 1;

                          return (
                            <button
                              onClick={() => {
                                // 设置待激活的技能并选中仁德
                                setPendingRendeSkill('neutral');
                                selectUnit(generalUnit.id);
                              }}
                              disabled={!isMyTurn || currentActionPoints < convertCost}
 className="btn-sy btn-sy-gold btn-sy-ability w-full px-4 py-2 rounded-lg text-sm font-bold"
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

            {/* 记号图例：盘面不出现文字的代价是得有一张图例。默认收起，不占高度。 */}
            <details
              className="rounded-lg p-3 sy-collapse"
              style={{ background: 'rgba(13,5,0,0.7)', border: '1px solid rgba(201,162,39,0.2)' }}
            >
              <summary className="cursor-pointer list-none flex items-baseline gap-2">
                <span className="text-base font-ancient tracking-wider" style={{ color: '#C9A227' }}>记号图例</span>
                <span className="text-xs font-chinese" style={{ color: 'rgba(201,162,39,0.45)' }}>颜色与记号的含义</span>
              </summary>
              <div className="mt-2">
                <LegendPanel compact />
              </div>
            </details>

            {/* 战报：从棋盘下方搬进右栏。
              * 放在下方时它要和棋盘抢同一屏的高度 —— 实测 1440×900 下战报占 218px，
              * 棋盘被压到 543×478，比改动前还小。搬进右栏后棋盘能吃掉整行高度，
              * 而且战报本来就在首屏内可见（原来它在首屏外 221px 处）。
              * 见 docs/layout-spec.md §3.2 */}
            <BattleLog
              logs={battleLogs}
              maxEntries={8}
              serverLogs={isOnlineMode ? serverBattleLog : undefined}
            />
          </div>
        </div>
      </div>

      {/* 太平将军·符水粥强制交互面板 */}
      {taipingFushuiActive && taipingFushuiPlayer === currentPlayer && isMyTurn && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
          <div className="rounded-lg p-6 max-w-sm w-full mx-4" style={{ background: 'linear-gradient(180deg, rgba(26,10,0,0.98) 0%, rgba(13,5,0,0.99) 100%)', border: '1px solid rgba(201,162,39,0.3)', boxShadow: '0 0 40px rgba(201,162,39,0.1)' }}>
            <h3 className="font-ancient text-xl tracking-widest mb-1" style={{ color: '#C9A227' }}>符水粥</h3>
            <p className="text-sm font-chinese mb-4" style={{ color: 'rgba(245,230,200,0.7)' }}>
              将残血步兵饮下符水粥，升为力士（消耗1点行动值）。<br/>
              剩余行动点：<span className="font-bold" style={{ color: '#E8C84A' }}>
                {currentPlayer === Player.PLAYER1 ? player1ActionPoints : player2ActionPoints}
              </span>
            </p>

            {/* 候选步兵列表（只显示普通步兵，黄巾力士不参与符水粥） */}
            <div className="space-y-2 max-h-48 overflow-y-auto mb-4">
              {Object.values(units)
                .filter((u: any) => u.owner === currentPlayer && u.type === UnitType.INFANTRY && u.hp === 1)
                .sort((a: any, b: any) => {
                  // 按距离太平将军由近到远排序
                  const general = Object.values(units).find((u: any) =>
                    u.owner === currentPlayer && u.type === UnitType.GENERAL && u.generalType === 'taiping'
                  ) as any;
                  if (!general) return 0;
                  const gPos = general.position || { q: general.q ?? 0, r: general.r ?? 0, s: general.s ?? 0 };
                  const aPos = (a as any).position || { q: (a as any).q ?? 0, r: (a as any).r ?? 0, s: (a as any).s ?? 0 };
                  const bPos = (b as any).position || { q: (b as any).q ?? 0, r: (b as any).r ?? 0, s: (b as any).s ?? 0 };
                  const distA = hexDistance(gPos, aPos);
                  const distB = hexDistance(gPos, bPos);
                  return distA - distB;
                })
                .map((u: any, idx) => {
                  const pos = u.position || { q: u.q ?? 0, r: u.r ?? 0, s: u.s ?? 0 };
                  return (
                    <button
                      key={u.id}
                      onClick={() => handleTaipingFushuiConvert(u.id)}
                      className="w-full text-left px-3 py-2 rounded text-sm font-chinese transition-all"
                      style={idx === 0 ? {
                        border: '1px solid rgba(201,162,39,0.5)',
                        background: 'rgba(201,162,39,0.1)',
                        color: '#E8C84A',
                      } : {
                        border: '1px solid rgba(201,162,39,0.2)',
                        background: 'rgba(13,5,0,0.5)',
                        color: 'rgba(245,230,200,0.6)',
                      }}
                    >
                      步兵 ({pos.q},{pos.r},{pos.s}) {idx === 0 ? '← 推荐' : ''}
                    </button>
                  );
                })}
            </div>

            <p className="text-xs font-chinese text-center" style={{ color: 'rgba(201,162,39,0.35)' }}>
              耗尽行动点或无候选步兵时自动退出
            </p>
          </div>
        </div>
      )}

      {/* 仁德击杀确认对话框 */}
      {rendeKillConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="rounded-lg p-6 max-w-md" style={{ background: 'linear-gradient(180deg, rgba(26,10,0,0.98) 0%, rgba(13,5,0,0.99) 100%)', border: '1px solid rgba(201,162,39,0.3)', boxShadow: '0 0 40px rgba(201,162,39,0.1)' }}>
            <h3 className="font-ancient text-xl tracking-widest mb-4" style={{ color: '#C9A227' }}>仁德将军击杀</h3>
            <p className="mb-6 font-chinese" style={{ color: 'rgba(245,230,200,0.8)' }}>
              你的仁��将军即将击杀敌方{rendeKillConfirm.target.type}，请选择：
            </p>
            <div className="flex gap-4">
              <button
                onClick={() => {
                  if (isOnlineMode) {
                    // 在线模式：发送击杀确认到服务器
                    colyseusService.rendeCompleteKill(rendeKillConfirm.target.id);
                  }
                  addLog(`仁德击杀了${rendeKillConfirm.target.type}`, 'kill');
                  setRendeKillConfirm(null);
                  selectUnit(null);
                }}
 className="btn-sy btn-sy-red flex-1 px-4 py-3 rounded-lg font-bold"
              >
                直接击杀
              </button>
              <button
                onClick={() => {
                  if (isOnlineMode) {
                    // 在线模式：发送转为中立标记到服务器
                    colyseusService.rendeSpareAsNeutral(rendeKillConfirm.target.id);
                  }
                  addLog(`仁德将${rendeKillConfirm.target.type}转为中立标记`, 'ability');
                  setRendeKillConfirm(null);
                  selectUnit(null);
                }}
                disabled={(() => {
                  // 计算所需行动点：机关单位根据占用格子数，普通单位1点
                  let requiredPoints = 1;
                  if (isMachineUnit(rendeKillConfirm.target.type)) {
                    const machineType = getMachineTypeStr(rendeKillConfirm.target.type)!;
                    const isPlayerOne = rendeKillConfirm.target.owner === Player.PLAYER1;
                    const occupiedHexes = getMachineOccupiedHexes(rendeKillConfirm.target.position, machineType, isPlayerOne);
                    requiredPoints = occupiedHexes.length;
                  }
                  return currentActionPoints < requiredPoints;
                })()}
 className="btn-sy btn-sy-gold btn-sy-ability flex-1 px-4 py-3 rounded-lg font-bold"
              >
                转为中立标记（消耗{(() => {
                  let requiredPoints = 1;
                  if (isMachineUnit(rendeKillConfirm.target.type)) {
                    const machineType = getMachineTypeStr(rendeKillConfirm.target.type)!;
                    const isPlayerOne = rendeKillConfirm.target.owner === Player.PLAYER1;
                    const occupiedHexes = getMachineOccupiedHexes(rendeKillConfirm.target.position, machineType, isPlayerOne);
                    requiredPoints = occupiedHexes.length;
                  }
                  return requiredPoints;
                })()}点）
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 规则书模态 */}
      <RulesModal isOpen={isRulesModalOpen} onClose={() => setRulesModalOpen(false)} />
    </div>
  );
};
