// 六边形坐标系统 (Cube Coordinates)
export interface HexCoord {
  q: number; // x 轴
  r: number; // y 轴
  s: number; // z 轴 (q + r + s = 0)
}

// 玩家
export enum Player {
  PLAYER1 = 'player1',
  PLAYER2 = 'player2',
  NEUTRAL = 'neutral',
}

// 单位类型
export enum UnitType {
  INFANTRY = 'infantry',      // 步兵 (一角)
  CAVALRY = 'cavalry',         // 骑兵 (一角+一角)
  ARCHER = 'archer',           // 弓箭手 (五角)
  GENERAL = 'general',         // 将军 (一元)
  BALLISTA = 'ballista',       // 弩车 (神机机关)
  CHARIOT = 'chariot',         // 战车 (神机机关)
  NEUTRAL_MARKER = 'neutral_marker', // 中立单位标记 (仁德专属)
}

// 方向 (六边形有6个方向，对应6条边)
// 对于 flat-top 布局的六边形
export enum Direction {
  EAST = 0,         // 东 (正东)
  NORTH_EAST = 1,   // 东北
  NORTH_WEST = 2,   // 西北
  WEST = 3,         // 西 (正西)
  SOUTH_WEST = 4,   // 西南
  SOUTH_EAST = 5,   // 东南
  NORTH = 6,        // 北 (正北，用于弩车等特殊单位)
  SOUTH = 7,        // 南 (正南，用于弩车等特殊单位)
}

// 将领类型
export enum GeneralType {
  WUSHUANG = 'wushuang',   // 无双
  SHENJI = 'shenji',       // 神机
  RENDE = 'rende',         // 仁德
}

// 单位状态
export interface Unit {
  id: string;
  type: UnitType;
  owner: Player;
  position: HexCoord;
  hp: number;               // 当前生命值 (1-2)
  maxHp: number;            // 最大生命值
  direction: Direction;     // 朝向 (弓箭手需要)
  actionsThisTurn: number;  // 本回合已执行的行动次数
  hasMoved: boolean;        // 本回合是否已移动
  hasAttacked: boolean;     // 本回合是否已攻击
  isFlipped: boolean;       // 是否被翻面 (受伤)
}

// 将军单位 (继承 Unit)
export interface General extends Unit {
  type: UnitType.GENERAL;
  generalType: GeneralType;
  abilityUsed: boolean;     // 一次性技能是否已使用
  isInvincible: boolean;    // 是否无敌 (无双技能)
  unlimitedActions?: boolean; // 本回合是否无限行动（无双一次性技能）
  hasFanAttacked?: boolean;  // 本回合是否已使用扇形攻击（无双专用）
  bonusActionLimit?: number; // 额外的行动次数上限（无双技能增加的）
  canConvertNeutral?: boolean; // 仁德：是否可以转化中立单位
  convertInfantryCost?: number; // 仁德：转化为步兵的当前费用（1, 2, 4, 8...）
}

// 机关单位 (神机专属)
export interface MachineUnit extends Unit {
  type: UnitType.BALLISTA | UnitType.CHARIOT;
  killCount: number;              // 击杀数 (用于判断骰子奖励)
  pierceCount?: number;           // 弩车：贯穿单位数（包含友方）
  hasActedThisTurn?: boolean;     // 机关单位：本回合是否已行动（移动或攻击）
}

// 行动类型
export enum ActionType {
  DEPLOY = 'deploy',
  MOVE = 'move',
  ATTACK = 'attack',
  ROTATE = 'rotate',
  ABILITY = 'ability',      // 使用技能
}

// 游戏阶段
export enum GamePhase {
  SETUP = 'setup',                    // 设置阶段 (选将、配兵、设置大本营)
  GENERAL_SELECT = 'general_select',  // 选择将领
  ARMY_BUILD = 'army_build',          // 配置部队
  BASE_SETUP = 'base_setup',          // 设置大本营
  DEPLOY = 'deploy',                  // 部署阶段
  ACTION = 'action',                  // 行动阶段
  END = 'end',                        // 游戏结束
}

// 游戏状态
export interface GameState {
  phase: GamePhase;
  currentPlayer: Player;
  turn: number;

  // 玩家配置
  player1General: GeneralType | null;
  player2General: GeneralType | null;
  player1Base: HexCoord | null;
  player2Base: HexCoord | null;

  // 部队配置 (预算4元)
  player1Army: {
    infantry: number;  // 步兵数量
    cavalry: number;   // 骑兵数量
    archer: number;    // 弓箭手数量
  };
  player2Army: {
    infantry: number;
    cavalry: number;
    archer: number;
  };

  // 地图上的单位
  units: Record<string, Unit>;

  // 骰子和行动点
  player1Dice: number;      // 玩家1的骰子数
  player2Dice: number;      // 玩家2的骰子数
  player1DiceResults: number[];  // 玩家1本回合的骰子结果
  player2DiceResults: number[];  // 玩家2本回合的骰子结果
  player1ActionPoints: number;
  player2ActionPoints: number;
  player1TempMaxActionPoints: number | null;  // 玩家1临时行动值上限（无双技能）
  player2TempMaxActionPoints: number | null;  // 玩家2临时行动值上限（无双技能）
  player1KillDice: number;  // 玩家1通过击杀获得的骰子数
  player2KillDice: number;  // 玩家2通过击杀获得的骰子数
  player1LostDice: number;  // 玩家1永久失去的骰子数
  player2LostDice: number;  // 玩家2永久失去的骰子数
  player1RerollTokens: number;  // 玩家1的重投次数（机关崩毁奖励）
  player2RerollTokens: number;  // 玩家2的重投次数（机关崩毁奖励）

  // 击杀统计
  player1KilledThisTurn: boolean;
  player2KilledThisTurn: boolean;

  // 选中的单位
  selectedUnitId: string | null;

  // 无双扇形攻击状态
  wushuangFanAttackActive?: boolean;
  wushuangAttackingPlayer?: string;
  wushuangAttackPhase?: 'select-direction' | 'second-roll' | 'second-attack' | 'third-roll' | 'third-attack';
  wushuangSelectedDirection?: number | null;
  wushuangDiceRolls?: number[];

  // 历史记录 (用于回放和撤销)
  history: GameState[];
}

// 地图配置
export interface MapConfig {
  radius: number;           // 六边形边长 (默认6)
  hexSize: number;          // 每个六边形的显示大小 (像素)
}

// 预算配置
export interface BudgetConfig {
  infantryCost: number;     // 步兵成本 (0.1元，即一角)
  cavalryCost: number;      // 骑兵成本 (0.2元，即两角)
  archerCost: number;       // 弓箭手成本 (0.5元，即五角)
  generalCost: number;      // 将军成本 (1元)
  totalBudget: number;      // 总预算 (4元)
}
