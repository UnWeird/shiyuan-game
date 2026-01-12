import { create } from 'zustand';
import type { GameState, HexCoord, Unit } from '../types';
import { GamePhase, Player, UnitType, GeneralType } from '../types';

interface GameStore extends GameState {
  // 在线模式相关
  isOnlineMode: boolean;
  myPlayerRole: 'player1' | 'player2' | 'spectator' | null;

  // 无双扇形攻击状态（需要显式声明以覆盖可选类型）
  wushuangFanAttackActive: boolean;
  wushuangAttackingPlayer: string;
  wushuangAttackPhase: 'select-direction' | 'second-roll' | 'second-attack' | 'third-roll' | 'third-attack';
  wushuangSelectedDirection: number | null;
  wushuangDiceRolls: number[];

  // 初始化游戏
  initGame: () => void;

  // 阶段控制
  setPhase: (phase: GamePhase) => void;
  nextPhase: () => void;

  // 玩家选择将领
  selectGeneral: (player: Player, general: GeneralType) => void;

  // 配置部队
  setArmy: (player: Player, infantry: number, cavalry: number, archer: number) => void;

  // 设置大本营
  setBase: (player: Player, position: HexCoord) => void;

  // 单位操作
  addUnit: (unit: Unit) => void;
  removeUnit: (unitId: string) => void;
  updateUnit: (unitId: string, updates: Partial<Unit>) => void;
  selectUnit: (unitId: string | null) => void;

  // 行动点操作
  setActionPoints: (player: Player, points: number) => void;
  addActionPoints: (player: Player, points: number) => void;
  consumeActionPoint: (player: Player) => void;
  setTempMaxActionPoints: (player: Player, max: number | null) => void;

  // 骰子操作
  rollDice: (player: Player) => number[];
  addDice: (player: Player, count: number) => void;
  removeDice: (player: Player, count: number) => void;
  modifyDiceResult: (player: Player, diceIndex: number, newValue: number) => void;

  // 重投次数操作
  addRerollToken: (player: Player) => void;
  rerollDice: (player: Player, diceIndex: number) => void;

  // 回合控制
  nextTurn: () => void;
  endTurn: () => void;

  // 击杀记录
  recordKill: (player: Player) => void;

  // 重置游戏
  resetGame: () => void;
}

const initialState: GameState = {
  phase: GamePhase.GENERAL_SELECT,
  currentPlayer: Player.PLAYER1,
  turn: 1,

  player1General: null,
  player2General: null,
  player1Base: null,
  player2Base: null,

  player1Army: {
    infantry: 0,
    cavalry: 0,
    archer: 0,
  },
  player2Army: {
    infantry: 0,
    cavalry: 0,
    archer: 0,
  },

  units: {},

  player1Dice: 0,
  player2Dice: 0,
  player1DiceResults: [],
  player2DiceResults: [],
  player1ActionPoints: 0,
  player2ActionPoints: 0,
  player1TempMaxActionPoints: null,
  player2TempMaxActionPoints: null,
  player1KillDice: 0,
  player2KillDice: 0,
  player1LostDice: 0,
  player2LostDice: 0,
  player1RerollTokens: 0,
  player2RerollTokens: 0,

  player1KilledThisTurn: false,
  player2KilledThisTurn: false,

  player1DeployedValue: 0,
  player2DeployedValue: 0,

  selectedUnitId: null,

  // 无双扇形攻击状态
  wushuangFanAttackActive: false,
  wushuangAttackingPlayer: '',
  wushuangAttackPhase: 'select-direction',
  wushuangSelectedDirection: null,
  wushuangDiceRolls: [],

  history: [],
};

export const useGameStore = create<GameStore>((set, get) => ({
  ...initialState,

  // 在线模式初始值
  isOnlineMode: false,
  myPlayerRole: null,

  // 无双扇形攻击状态初始值
  wushuangFanAttackActive: false,
  wushuangAttackingPlayer: '',
  wushuangAttackPhase: 'select-direction',
  wushuangSelectedDirection: null,
  wushuangDiceRolls: [],

  initGame: () => {
    set(initialState);
  },

  setPhase: (phase: GamePhase) => {
    set({ phase });
  },

  nextPhase: () => {
    const { phase } = get();
    let nextPhase = phase;

    switch (phase) {
      case GamePhase.GENERAL_SELECT:
        nextPhase = GamePhase.ARMY_BUILD;
        break;
      case GamePhase.ARMY_BUILD:
        nextPhase = GamePhase.BASE_SETUP;
        break;
      case GamePhase.BASE_SETUP:
        nextPhase = GamePhase.DEPLOY;
        // 回合1开始: 玩家1部署阶段,无限行动点
        set({
          player1Dice: 4, // 4元预算 = 4颗骰子
          player2Dice: 4,
          player1ActionPoints: 999, // 无限行动点用于部署
          turn: 1,
          currentPlayer: Player.PLAYER1,
        });
        break;
      case GamePhase.DEPLOY:
        nextPhase = GamePhase.ACTION;
        break;
      case GamePhase.ACTION:
        // 行动阶段结束后不自动切换，需要手动结束回合
        break;
    }

    set({ phase: nextPhase });
  },

  selectGeneral: (player: Player, general: GeneralType) => {
    if (player === Player.PLAYER1) {
      set({ player1General: general });
    } else if (player === Player.PLAYER2) {
      set({ player2General: general });
    }
  },

  setArmy: (player: Player, infantry: number, cavalry: number, archer: number) => {
    if (player === Player.PLAYER1) {
      set({ player1Army: { infantry, cavalry, archer } });
    } else if (player === Player.PLAYER2) {
      set({ player2Army: { infantry, cavalry, archer } });
    }
  },

  setBase: (player: Player, position: HexCoord) => {
    if (player === Player.PLAYER1) {
      set({ player1Base: position });
    } else if (player === Player.PLAYER2) {
      set({ player2Base: position });
    }
  },

  addUnit: (unit: Unit) => {
    set(state => ({
      units: { ...state.units, [unit.id]: unit },
    }));
  },

  removeUnit: (unitId: string) => {
    set(state => {
      const { [unitId]: _removed, ...rest } = state.units;
      return { units: rest };
    });
  },

  updateUnit: (unitId: string, updates: Partial<Unit>) => {
    set(state => ({
      units: {
        ...state.units,
        [unitId]: { ...state.units[unitId], ...updates },
      },
    }));
  },

  selectUnit: (unitId: string | null) => {
    set({ selectedUnitId: unitId });
  },

  setActionPoints: (player: Player, points: number) => {
    if (player === Player.PLAYER1) {
      set({ player1ActionPoints: points });
    } else if (player === Player.PLAYER2) {
      set({ player2ActionPoints: points });
    }
  },

  addActionPoints: (player: Player, points: number) => {
    const state = get();
    if (player === Player.PLAYER1) {
      set({ player1ActionPoints: state.player1ActionPoints + points });
    } else if (player === Player.PLAYER2) {
      set({ player2ActionPoints: state.player2ActionPoints + points });
    }
  },

  consumeActionPoint: (player: Player) => {
    const state = get();
    if (player === Player.PLAYER1 && state.player1ActionPoints > 0) {
      const newPoints = state.player1ActionPoints - 1;
      set({ player1ActionPoints: newPoints });
      // 如果行动点耗尽，自动切换回合（直接掷骰子，不显示中间界面）
      if (newPoints === 0) {
        setTimeout(() => {
          get().nextTurn();
        }, 500);
      }
    } else if (player === Player.PLAYER2 && state.player2ActionPoints > 0) {
      const newPoints = state.player2ActionPoints - 1;
      set({ player2ActionPoints: newPoints });
      // 如果行动点耗尽，自动切换回合（直接掷骰子，不显示中间界面）
      if (newPoints === 0) {
        setTimeout(() => {
          get().nextTurn();
        }, 500);
      }
    }
  },

  setTempMaxActionPoints: (player: Player, max: number | null) => {
    if (player === Player.PLAYER1) {
      set({ player1TempMaxActionPoints: max });
    } else if (player === Player.PLAYER2) {
      set({ player2TempMaxActionPoints: max });
    }
  },

  rollDice: (player: Player) => {
    const state = get();
    const diceCount = player === Player.PLAYER1 ? state.player1Dice : state.player2Dice;
    const results: number[] = [];
    let totalPoints = 0;

    for (let i = 0; i < diceCount; i++) {
      const roll = Math.floor(Math.random() * 6) + 1;
      results.push(roll);
      totalPoints += roll;
    }

    // 设置行动点和骰子结果
    if (player === Player.PLAYER1) {
      set({
        player1ActionPoints: totalPoints,
        player1DiceResults: results,
      });
    } else {
      set({
        player2ActionPoints: totalPoints,
        player2DiceResults: results,
      });
    }

    return results;
  },

  addDice: (player: Player, count: number) => {
    const state = get();
    if (player === Player.PLAYER1) {
      set({ player1Dice: state.player1Dice + count });
    } else if (player === Player.PLAYER2) {
      set({ player2Dice: state.player2Dice + count });
    }
  },

  removeDice: (player: Player, count: number) => {
    const state = get();
    if (player === Player.PLAYER1) {
      set({
        player1Dice: Math.max(0, state.player1Dice - count),
        player1LostDice: state.player1LostDice + count,
      });
    } else if (player === Player.PLAYER2) {
      set({
        player2Dice: Math.max(0, state.player2Dice - count),
        player2LostDice: state.player2LostDice + count,
      });
    }
  },

  modifyDiceResult: (player: Player, diceIndex: number, newValue: number) => {
    const state = get();
    if (newValue < 1 || newValue > 6) return; // 骰子点数必须在1-6之间

    if (player === Player.PLAYER1) {
      const newResults = [...state.player1DiceResults];
      if (diceIndex >= 0 && diceIndex < newResults.length) {
        const oldValue = newResults[diceIndex];
        newResults[diceIndex] = newValue;
        // 更新行动点
        const pointsDiff = newValue - oldValue;
        set({
          player1DiceResults: newResults,
          player1ActionPoints: state.player1ActionPoints + pointsDiff,
        });
      }
    } else if (player === Player.PLAYER2) {
      const newResults = [...state.player2DiceResults];
      if (diceIndex >= 0 && diceIndex < newResults.length) {
        const oldValue = newResults[diceIndex];
        newResults[diceIndex] = newValue;
        // 更新行动点
        const pointsDiff = newValue - oldValue;
        set({
          player2DiceResults: newResults,
          player2ActionPoints: state.player2ActionPoints + pointsDiff,
        });
      }
    }
  },

  addRerollToken: (player: Player) => {
    const state = get();
    if (player === Player.PLAYER1) {
      set({ player1RerollTokens: state.player1RerollTokens + 1 });
    } else if (player === Player.PLAYER2) {
      set({ player2RerollTokens: state.player2RerollTokens + 1 });
    }
  },

  rerollDice: (player: Player, diceIndex: number) => {
    const state = get();

    // 检查是否有重投次数
    const hasToken = player === Player.PLAYER1
      ? state.player1RerollTokens > 0
      : state.player2RerollTokens > 0;

    if (!hasToken) return;

    // 检查骰子索引是否有效
    const diceResults = player === Player.PLAYER1 ? state.player1DiceResults : state.player2DiceResults;
    if (diceIndex < 0 || diceIndex >= diceResults.length) return;

    // 重新投掷该骰子
    const oldValue = diceResults[diceIndex];
    const newValue = Math.floor(Math.random() * 6) + 1;
    const newResults = [...diceResults];
    newResults[diceIndex] = newValue;

    // 根据新旧值更新行动点
    const pointsDiff = newValue - oldValue;

    if (player === Player.PLAYER1) {
      // 如果新值更大，同时增加已用和总点数
      // 如果新值更小，只减小总点数（已用点数不变）
      const newActionPoints = newValue > oldValue
        ? state.player1ActionPoints + pointsDiff  // 新值大：增加未使用点数
        : state.player1ActionPoints;              // 新值小：保持未使用点数不变

      set({
        player1DiceResults: newResults,
        player1ActionPoints: newActionPoints,
        player1RerollTokens: state.player1RerollTokens - 1,
      });
    } else if (player === Player.PLAYER2) {
      const newActionPoints = newValue > oldValue
        ? state.player2ActionPoints + pointsDiff
        : state.player2ActionPoints;

      set({
        player2DiceResults: newResults,
        player2ActionPoints: newActionPoints,
        player2RerollTokens: state.player2RerollTokens - 1,
      });
    }
  },

  nextTurn: () => {
    const state = get();

    // 重置所有单位的行动状态
    const updatedUnits: Record<string, Unit> = {};
    Object.entries(state.units).forEach(([id, unit]) => {
      updatedUnits[id] = {
        ...unit,
        actionsThisTurn: 0,
        hasMoved: false,
        hasAttacked: false,
        // 重置无双将军的无敌状态和无限行动状态
        ...(unit.type === UnitType.GENERAL ? {
          isInvincible: false,
          unlimitedActions: false,
          hasFanAttacked: false,
          bonusActionLimit: 0, // 重置额外行动次数上限
        } : {}),
        // 重置机关单位的已行动状态
        ...(unit.type === UnitType.BALLISTA || unit.type === UnitType.CHARIOT ? {
          hasActedThisTurn: false,
        } : {}),
      };
    });

    // 回合1结束: 玩家1部署结束,切换到玩家2
    if (state.turn === 1 && state.currentPlayer === Player.PLAYER1) {
      // 计算玩家1部署的数额来决定玩家2的骰子数
      const player1DeployedValue = Object.values(state.units)
        .filter(u => u.owner === Player.PLAYER1 && u.type !== UnitType.GENERAL)
        .reduce((sum, u) => {
          if (u.type === UnitType.INFANTRY) return sum + 0.1;
          if (u.type === UnitType.CAVALRY) return sum + 0.2;
          if (u.type === UnitType.ARCHER) return sum + 0.5;
          if (u.type === UnitType.BALLISTA) return sum + 0.9;
          if (u.type === UnitType.CHARIOT) return sum + 0.6;
          return sum;
        }, 0);

      // 部署阶段特殊规则：先手者每1元给后手者1颗骰子
      const player2DiceCount = Math.floor(player1DeployedValue);

      set({
        currentPlayer: Player.PLAYER2,
        turn: 2,
        phase: GamePhase.DEPLOY,
        units: updatedUnits,
        player1KilledThisTurn: false,
        player2KilledThisTurn: false,
        // 重置击杀骰子计数（只在当回合有效）
        player1KillDice: 0,
        player2KillDice: 0,
        // 重置临时行动值上限
        player1TempMaxActionPoints: null,
        player2TempMaxActionPoints: null,
        player2Dice: player2DiceCount,
      });

      // 玩家2掷骰子
      get().rollDice(Player.PLAYER2);
      return;
    }

    // 回合2结束或之后: 进入正常游戏
    const nextPlayer = state.currentPlayer === Player.PLAYER1 ? Player.PLAYER2 : Player.PLAYER1;
    const newTurn = state.turn + 1;
    const newPhase = GamePhase.ACTION;

    // 计算下一个玩家的骰子数量 (保底1颗 + 每2元加1颗)
    const calculateDiceCount = (player: Player) => {
      const deployedValue = Object.values(state.units)
        .filter(u => u.owner === player && u.type !== UnitType.GENERAL)
        .reduce((sum, u) => {
          if (u.type === UnitType.INFANTRY) return sum + 0.1;
          if (u.type === UnitType.CAVALRY) return sum + 0.2;
          if (u.type === UnitType.ARCHER) return sum + 0.5;
          if (u.type === UnitType.BALLISTA) return sum + 0.9;
          if (u.type === UnitType.CHARIOT) return sum + 0.6;
          return sum;
        }, 0);

      // 检查将军是否存活（决定保底骰子）
      const generalAlive = Object.values(state.units).some(u =>
        u.owner === player && u.type === UnitType.GENERAL
      );
      const baseDice = generalAlive ? 1 : 0;

      return baseDice + Math.floor(deployedValue / 2);
    };

    const newDiceCount = calculateDiceCount(nextPlayer);

    set({
      currentPlayer: nextPlayer,
      turn: newTurn,
      phase: newPhase,
      units: updatedUnits,
      player1KilledThisTurn: false,
      player2KilledThisTurn: false,
      // 重置击杀骰子计数（只在当回合有效）
      player1KillDice: 0,
      player2KillDice: 0,
      // 重置临时行动值上限
      player1TempMaxActionPoints: null,
      player2TempMaxActionPoints: null,
      ...(nextPlayer === Player.PLAYER1 ? { player1Dice: newDiceCount } : { player2Dice: newDiceCount }),
    });

    // 掷骰子
    get().rollDice(nextPlayer);
  },

  endTurn: () => {
    get().nextTurn();
  },

  recordKill: (player: Player) => {
    const state = get();

    if (player === Player.PLAYER1 && !state.player1KilledThisTurn) {
      set({
        player1KilledThisTurn: true,
        player1KillDice: state.player1KillDice + 1,
      });
      // 增加骰子数并立即投掷这颗额外的骰子
      get().addDice(Player.PLAYER1, 1);
      // 投掷额外的骰子并增加行动点
      const extraRoll = Math.floor(Math.random() * 6) + 1;
      set({
        player1DiceResults: [...state.player1DiceResults, extraRoll],
      });
      get().addActionPoints(Player.PLAYER1, extraRoll);
    } else if (player === Player.PLAYER2 && !state.player2KilledThisTurn) {
      set({
        player2KilledThisTurn: true,
        player2KillDice: state.player2KillDice + 1,
      });
      // 增加骰子数并立即投掷这颗额外的骰子
      get().addDice(Player.PLAYER2, 1);
      // 投掷额外的骰子并增加行动点
      const extraRoll = Math.floor(Math.random() * 6) + 1;
      set({
        player2DiceResults: [...state.player2DiceResults, extraRoll],
      });
      get().addActionPoints(Player.PLAYER2, extraRoll);
    }
  },

  resetGame: () => {
    set(initialState);
  },
}));
