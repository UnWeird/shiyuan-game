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

  // 战斗状态标记
  @type("number") moveDistance: number = 0; // 骑兵本回合移动距离
  @type("boolean") movementRestricted: boolean = false; // 步兵纵深抗击限制
  @type("number") movementRestrictionSourceQ: number = 0; // 限制来源Q坐标
  @type("number") movementRestrictionSourceR: number = 0; // 限制来源R坐标
  @type("number") movementRestrictionSourceS: number = 0; // 限制来源S坐标
  @type("boolean") cannotMoveNextTurn: boolean = false; // 弩车贯穿限制
  @type("boolean") cannotRotateNextTurn: boolean = false; // 弩车贯穿限制
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

  // 选中的单位
  @type("string") selectedUnitId: string = "";

  // 战斗日志（最近的N条消息）
  @type(["string"]) battleLog = new ArraySchema<string>();

  // 无双扇形攻击状态（多阶段技能）
  @type("boolean") wushuangFanAttackActive: boolean = false;
  @type("string") wushuangAttackingPlayer: string = ""; // 正在使用扇形攻击的玩家
  @type("string") wushuangAttackPhase: string = ""; // 'select-direction' | 'second-roll' | 'second-attack' | 'third-roll' | 'third-attack'
  @type("number") wushuangSelectedDirection: number = -1; // -1 表示未选择
  @type(["number"]) wushuangDiceRolls = new ArraySchema<number>(); // 扇形攻击的掷骰记录
}
