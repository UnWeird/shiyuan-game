import { Schema, type, MapSchema, ArraySchema } from '@colyseus/schema';

/**
 * 单位 Schema
 * Colyseus 会自动同步这些字段的变化到客户端
 */
export class UnitSchema extends Schema {
  @type("string") id: string = "";
  @type("string") type: string = ""; // infantry, cavalry, archer, general, etc.
  @type("string") owner: string = ""; // player1, player2, neutral

  // 位置（六边形坐标）
  @type("number") q: number = 0;
  @type("number") r: number = 0;
  @type("number") s: number = 0;

  // 状态
  @type("number") hp: number = 1;
  @type("number") maxHp: number = 1;
  @type("number") direction: number = 0; // Direction enum 值
  @type("number") actionsThisTurn: number = 0;
  @type("boolean") hasMoved: boolean = false;
  @type("boolean") hasAttacked: boolean = false;
  @type("boolean") hasRotated: boolean = false; // 弓箭手是否已转向

  // 将军专属字段
  @type("string") generalType: string = ""; // wushuang, shenji, rende
  @type("boolean") abilityUsed: boolean = false;
  @type("boolean") isInvincible: boolean = false;
  @type("boolean") unlimitedActions: boolean = false;
  @type("boolean") hasFanAttacked: boolean = false;
  @type("number") bonusActionLimit: number = 0;
  @type("boolean") canConvertNeutral: boolean = false;
  @type("number") convertInfantryCost: number = 1;

  // 机关单位专属
  @type("number") killCount: number = 0;
  @type("number") pierceCount: number = 0;
  @type("boolean") hasActedThisTurn: boolean = false;
  @type("number") chargeLevel: number = 0; // 投石车蓄力层数

  /**
   * 投石车：本回合是否已蓄力。
   *
   * 基础规则是「每回合最多 2 个行动，每种行动最多 1 次」，另三种行动各有
   * 自己的标记（hasMoved / hasAttacked / hasRotated），蓄力一直缺一个 ——
   * 于是它是唯一能在一回合内做两次的行动，两次就直接满层。
   */
  @type("boolean") hasCharged: boolean = false;

  // 战斗状态标记
  @type("number") moveDistance: number = 0; // 骑兵本回合移动距离
  @type("boolean") movementRestricted: boolean = false; // 步兵纵深抗击限制
  @type("number") movementRestrictionSourceQ: number = 0; // 限制来源Q坐标
  @type("number") movementRestrictionSourceR: number = 0; // 限制来源R坐标
  @type("number") movementRestrictionSourceS: number = 0; // 限制来源S坐标
  @type("boolean") cannotMoveNextTurn: boolean = false; // 弩车贯穿限制
  @type("boolean") cannotRotateNextTurn: boolean = false; // 弩车贯穿限制

  // 太平将军专属标记
  //
  // statusTag 用来区分「同一个 type 的两种来源」：
  // 公共平民和仁德自造的中立标记都是 type=neutral_marker，但死亡结算不同
  //（公共平民死亡扣太平天命、不重置仁德招降费用），所以必须在数据上可分。
  @type("string") statusTag: string = ""; // "" 普通 | "civilian" 公共平民

  /**
   * 黄巾贼：作乱充能是否充满。
   *
   * 二态而不是层数 —— 作乱和腐化共用这一个开关，用掉就耗尽，
   * 主动移动一次即充满。非贼单位恒为 false。
   */
  @type("boolean") charged: boolean = false;
}

/**
 * 太平将军的阵营状态（每方一份）
 *
 * 为什么是嵌套 Schema 而不是顶层字段：`GameStateSchema` 的字段数有
 * Colyseus 的 64 上限，旧太平那 14 个字段正好把它占满（见 commit dc72383）。
 * 收进嵌套 Schema 后顶层只占 2 格，而且以后给太平加状态不用再动顶层结构。
 *
 * 刻意**不存**「太平是否存活」：它可以由「选了太平」+「units 里还有没有太平将军」
 * 精确推出，存一份反而会漂移。
 */
export class TaipingSchema extends Schema {
  /** 天命值，初始 5，下限 0 上限 12 */
  @type("number") destiny: number = 5;

  /** 本轮次已因平民死亡失去的天命（上限 2，turn++ 时清零） */
  @type("number") destinyLostThisRound: number = 0;

  /** 本回合是否已用过符水粥（黄天当立的条件之一） */
  @type("boolean") fushuiUsedThisTurn: boolean = false;

  /** 上次夺天命的黄天骰 / 苍天骰，仅用于界面展示 */
  @type("number") lastHuangtian: number = 0;
  @type("number") lastCangtian: number = 0;

  /**
   * 宣告「黄天当立」时的回合数，-1 表示未宣告。
   *
   * 判定点是宣告方的下一个回合开始，届时 `turn === declaredTurn + 1`
   * —— player1 和 player2 都成立（turn 在切回 player1 时才 ++），
   * 所以一个数字就够，不需要额外记「经过了几个回合」。
   */
  @type("number") huangtianDeclaredTurn: number = -1;

  /** 豆饭：本回合待征募的平民 id（阶段开始时快照，非空时拦截其他指令） */
  @type(["string"]) pendingRecruit = new ArraySchema<string>();

  /** 腐化：本回合待处理的黄巾贼 id（同上） */
  @type(["string"]) pendingCorrupt = new ArraySchema<string>();
}

/**
 * 游戏状态 Schema
 * 这是整个游戏的核心状态，会自动同步到所有客户端
 */
export class GameStateSchema extends Schema {
  // 游戏阶段
  @type("string") phase: string = "general_select"; // GamePhase enum 值
  @type("string") currentPlayer: string = "player1"; // Player enum 值
  @type("number") turn: number = 1;

  // 玩家1配置
  @type("string") player1General: string = "";
  @type("number") player1BaseQ: number = 0;
  @type("number") player1BaseR: number = 0;
  @type("number") player1BaseS: number = 0;
  @type("number") player1Infantry: number = 0;
  @type("number") player1Cavalry: number = 0;
  @type("number") player1Archer: number = 0;

  // 玩家1已消耗库存（永久消耗，不会因单位死亡而减少）
  @type("number") player1ConsumedInfantry: number = 0;
  @type("number") player1ConsumedCavalry: number = 0;
  @type("number") player1ConsumedArcher: number = 0;

  // 玩家2配置
  @type("string") player2General: string = "";
  @type("number") player2BaseQ: number = 0;
  @type("number") player2BaseR: number = 0;
  @type("number") player2BaseS: number = 0;
  @type("number") player2Infantry: number = 0;
  @type("number") player2Cavalry: number = 0;
  @type("number") player2Archer: number = 0;

  // 玩家2已消耗库存（永久消耗，不会因单位死亡而减少）
  @type("number") player2ConsumedInfantry: number = 0;
  @type("number") player2ConsumedCavalry: number = 0;
  @type("number") player2ConsumedArcher: number = 0;

  // 地图上的单位（MapSchema 会自动同步增删改）
  @type({ map: UnitSchema }) units = new MapSchema<UnitSchema>();

  // 骰子系统
  @type("number") player1Dice: number = 4;
  @type("number") player2Dice: number = 4;
  @type(["number"]) player1DiceResults = new ArraySchema<number>();
  @type(["number"]) player2DiceResults = new ArraySchema<number>();
  @type("number") player1ActionPoints: number = 0;
  @type("number") player2ActionPoints: number = 0;
  @type("number") player1TempMaxActionPoints: number = -1; // -1表示null
  @type("number") player2TempMaxActionPoints: number = -1;
  @type("number") player1KillDice: number = 0;
  @type("number") player2KillDice: number = 0;
  @type("number") player1LostDice: number = 0;
  @type("number") player2LostDice: number = 0;
  @type("number") player1RerollTokens: number = 0;
  @type("number") player2RerollTokens: number = 0;

  // 部署价值（用于显示和调试骰子数计算）
  @type("number") player1DeployedValue: number = 0; // 已部署单位的总价值（元）
  @type("number") player2DeployedValue: number = 0;

  // 击杀统计
  @type("boolean") player1KilledThisTurn: boolean = false;
  @type("boolean") player2KilledThisTurn: boolean = false;
  @type("boolean") player1KilledLastTurn: boolean = false;
  @type("boolean") player2KilledLastTurn: boolean = false;

  // 战斗日志（最近的N条消息）
  @type(["string"]) battleLog = new ArraySchema<string>();

  // 无双扇形攻击状态（多阶段技能）
  @type("boolean") wushuangFanAttackActive: boolean = false;
  @type("string") wushuangAttackingPlayer: string = ""; // 正在使用扇形攻击的玩家
  @type("string") wushuangAttackPhase: string = ""; // 'select-direction' | 'second-roll' | 'second-attack' | 'third-roll' | 'third-attack'
  @type("number") wushuangSelectedDirection: number = -1; // -1 表示未选择
  @type(["number"]) wushuangDiceRolls = new ArraySchema<number>(); // 扇形攻击的掷骰记录

  // 太平将军专属状态：收进嵌套 Schema，顶层只占 2 格（见 TaipingSchema 注释）
  @type(TaipingSchema) player1Taiping = new TaipingSchema();
  @type(TaipingSchema) player2Taiping = new TaipingSchema();
}
