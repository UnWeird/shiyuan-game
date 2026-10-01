/**
 * 客户端类型定义
 *
 * 基础类型（坐标、枚举、配置）统一从 shared/types.ts 再导出，
 * 不再在这里重复声明 —— 枚举在 TypeScript 里是名义类型，
 * 同一个枚举声明两遍会得到互不兼容的两个类型，
 * 客户端就没法把自己的 Direction 传给 shared 里的六边形工具函数。
 *
 * Unit / General / MachineUnit / GameState 保留在本地：
 * 客户端这几个接口已经和 shared 版本分歧（多了 statusTag、
 * movementRestrictionSourceQ/R/S、太平将军状态、已消耗库存等字段），
 * 合并它们是另一件事，不在这次去重范围内。
 */
export type { HexCoord, MapConfig, BudgetConfig } from '../../../shared/types';
export { Player, UnitType, Direction, GeneralType, ActionType, GamePhase } from '../../../shared/types';

// 下面这些类型需要引用基础类型，导入一份本地别名
import type { HexCoord } from '../../../shared/types';
import { UnitType, Player, Direction, GeneralType, GamePhase } from '../../../shared/types';

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
  moveDistance?: number;    // 骑兵：本回合移动的距离（1/2/3）
  movementRestricted?: boolean; // 步兵：是否被限制前进（纵深抗击效果）
  movementRestrictionSourceQ?: number; // 步兵移动限制来源Q坐标
  movementRestrictionSourceR?: number; // 步兵移动限制来源R坐标
  movementRestrictionSourceS?: number; // 步兵移动限制来源S坐标
  cannotMoveNextTurn?: boolean;  // 弩车贯穿击中的最后单位：下回合不能移动
  cannotRotateNextTurn?: boolean; // 弩车贯穿击中的最后单位：下回合不能转向
  statusTag?: string; // 太平将军专属：'' 普通 | 'lishi' 力士 | 'zei' 贼
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
  type: UnitType.BALLISTA | UnitType.CHARIOT | UnitType.CATAPULT;
  killCount: number;              // 击杀数 (用于判断骰子奖励)
  pierceCount?: number;           // 弩车：贯穿单位数（包含友方）
  hasActedThisTurn?: boolean;     // 机关单位：本回合是否已行动（移动或攻击）
  chargeLevel?: number;           // 投石车：蓄力层数（0/1/2）
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

  // 已消耗库存 (永久消耗，不会因单位死亡而减少)
  player1ConsumedStock: {
    infantry: number;  // 已消耗步兵数
    cavalry: number;   // 已消耗骑兵数
    archer: number;    // 已消耗弓箭手数
  };
  player2ConsumedStock: {
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
  player1KilledLastTurn: boolean;
  player2KilledLastTurn: boolean;

  // 部署价值（用于显示和调试）
  player1DeployedValue: number;
  player2DeployedValue: number;

  // 选中的单位
  selectedUnitId: string | null;

  // 无双扇形攻击状态
  wushuangFanAttackActive: boolean;
  wushuangAttackingPlayer: string;
  wushuangAttackPhase: 'select-direction' | 'second-roll' | 'second-attack' | 'third-roll' | 'third-attack';
  wushuangSelectedDirection: number | null;
  wushuangDiceRolls: number[];

  // 太平将军专属状态
  player1DestinyValue: number;
  player2DestinyValue: number;
  taipingFushuiActive: boolean;
  taipingFushuiPlayer: string;
  taipingTianmingActive: boolean;
  taipingTianmingPlayer: string;
  taipingTianmingCangtiandi: number;
  taipingTianmingHuangtian: number;
  taipingTianmingDamage: number;
  taipingTianmingOldDestiny: number;
  // 双太平共享状态
  taipingSharedHp: number;
  taipingSharedMaxHp: number;
  player1DoufanUsedThisTurn: boolean;
  player2DoufanUsedThisTurn: boolean;
  player1TaipingDeployInitDone: boolean;
  player2TaipingDeployInitDone: boolean;

  // 服务端权威战报（仅在线模式有值；单机模式用 GameBoard 本地日志）
  serverBattleLog: string[];

  // 历史记录 (用于回放和撤销)
  history: GameState[];
}

