"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameStateSchema = exports.UnitSchema = void 0;
const schema_1 = require("@colyseus/schema");
/**
 * 单位 Schema
 * Colyseus 会自动同步这些字段的变化到客户端
 */
class UnitSchema extends schema_1.Schema {
    constructor() {
        super(...arguments);
        this.id = "";
        this.type = ""; // infantry, cavalry, archer, general, etc.
        this.owner = ""; // player1, player2, neutral
        // 位置（六边形坐标）
        this.q = 0;
        this.r = 0;
        this.s = 0;
        // 状态
        this.hp = 1;
        this.maxHp = 1;
        this.direction = 0; // Direction enum 值
        this.actionsThisTurn = 0;
        this.hasMoved = false;
        this.hasAttacked = false;
        this.hasRotated = false; // 弓箭手是否已转向
        // 将军专属字段
        this.generalType = ""; // wushuang, shenji, rende
        this.abilityUsed = false;
        this.isInvincible = false;
        this.unlimitedActions = false;
        this.hasFanAttacked = false;
        this.bonusActionLimit = 0;
        this.canConvertNeutral = false;
        this.convertInfantryCost = 1;
        // 机关单位专属
        this.killCount = 0;
        this.pierceCount = 0;
        this.hasActedThisTurn = false;
        this.chargeLevel = 0; // 投石车蓄力层数
        // 战斗状态标记
        this.moveDistance = 0; // 骑兵本回合移动距离
        this.movementRestricted = false; // 步兵纵深抗击限制
        this.movementRestrictionSourceQ = 0; // 限制来源Q坐标
        this.movementRestrictionSourceR = 0; // 限制来源R坐标
        this.movementRestrictionSourceS = 0; // 限制来源S坐标
        this.cannotMoveNextTurn = false; // 弩车贯穿限制
        this.cannotRotateNextTurn = false; // 弩车贯穿限制
    }
}
exports.UnitSchema = UnitSchema;
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], UnitSchema.prototype, "id", void 0);
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], UnitSchema.prototype, "type", void 0);
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], UnitSchema.prototype, "owner", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], UnitSchema.prototype, "q", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], UnitSchema.prototype, "r", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], UnitSchema.prototype, "s", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], UnitSchema.prototype, "hp", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], UnitSchema.prototype, "maxHp", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], UnitSchema.prototype, "direction", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], UnitSchema.prototype, "actionsThisTurn", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], UnitSchema.prototype, "hasMoved", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], UnitSchema.prototype, "hasAttacked", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], UnitSchema.prototype, "hasRotated", void 0);
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], UnitSchema.prototype, "generalType", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], UnitSchema.prototype, "abilityUsed", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], UnitSchema.prototype, "isInvincible", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], UnitSchema.prototype, "unlimitedActions", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], UnitSchema.prototype, "hasFanAttacked", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], UnitSchema.prototype, "bonusActionLimit", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], UnitSchema.prototype, "canConvertNeutral", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], UnitSchema.prototype, "convertInfantryCost", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], UnitSchema.prototype, "killCount", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], UnitSchema.prototype, "pierceCount", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], UnitSchema.prototype, "hasActedThisTurn", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], UnitSchema.prototype, "chargeLevel", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], UnitSchema.prototype, "moveDistance", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], UnitSchema.prototype, "movementRestricted", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], UnitSchema.prototype, "movementRestrictionSourceQ", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], UnitSchema.prototype, "movementRestrictionSourceR", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], UnitSchema.prototype, "movementRestrictionSourceS", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], UnitSchema.prototype, "cannotMoveNextTurn", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], UnitSchema.prototype, "cannotRotateNextTurn", void 0);
/**
 * 游戏状态 Schema
 * 这是整个游戏的核心状态，会自动同步到所有客户端
 */
class GameStateSchema extends schema_1.Schema {
    constructor() {
        super(...arguments);
        // 游戏阶段
        this.phase = "general_select"; // GamePhase enum 值
        this.currentPlayer = "player1"; // Player enum 值
        this.turn = 1;
        // 玩家1配置
        this.player1General = "";
        this.player1BaseQ = 0;
        this.player1BaseR = 0;
        this.player1BaseS = 0;
        this.player1Infantry = 0;
        this.player1Cavalry = 0;
        this.player1Archer = 0;
        // 玩家1已消耗库存（永久消耗，不会因单位死亡而减少）
        this.player1ConsumedInfantry = 0;
        this.player1ConsumedCavalry = 0;
        this.player1ConsumedArcher = 0;
        // 玩家2配置
        this.player2General = "";
        this.player2BaseQ = 0;
        this.player2BaseR = 0;
        this.player2BaseS = 0;
        this.player2Infantry = 0;
        this.player2Cavalry = 0;
        this.player2Archer = 0;
        // 玩家2已消耗库存（永久消耗，不会因单位死亡而减少）
        this.player2ConsumedInfantry = 0;
        this.player2ConsumedCavalry = 0;
        this.player2ConsumedArcher = 0;
        // 地图上的单位（MapSchema 会自动同步增删改）
        this.units = new schema_1.MapSchema();
        // 骰子系统
        this.player1Dice = 4;
        this.player2Dice = 4;
        this.player1DiceResults = new schema_1.ArraySchema();
        this.player2DiceResults = new schema_1.ArraySchema();
        this.player1ActionPoints = 0;
        this.player2ActionPoints = 0;
        this.player1TempMaxActionPoints = -1; // -1表示null
        this.player2TempMaxActionPoints = -1;
        this.player1KillDice = 0;
        this.player2KillDice = 0;
        this.player1LostDice = 0;
        this.player2LostDice = 0;
        this.player1RerollTokens = 0;
        this.player2RerollTokens = 0;
        // 部署价值（用于显示和调试骰子数计算）
        this.player1DeployedValue = 0; // 已部署单位的总价值（元）
        this.player2DeployedValue = 0;
        // 击杀统计
        this.player1KilledThisTurn = false;
        this.player2KilledThisTurn = false;
        this.player1KilledLastTurn = false;
        this.player2KilledLastTurn = false;
        // 选中的单位
        this.selectedUnitId = "";
        // 战斗日志（最近的N条消息）
        this.battleLog = new schema_1.ArraySchema();
        // 无双扇形攻击状态（多阶段技能）
        this.wushuangFanAttackActive = false;
        this.wushuangAttackingPlayer = ""; // 正在使用扇形攻击的玩家
        this.wushuangAttackPhase = ""; // 'select-direction' | 'second-roll' | 'second-attack' | 'third-roll' | 'third-attack'
        this.wushuangSelectedDirection = -1; // -1 表示未选择
        this.wushuangDiceRolls = new schema_1.ArraySchema(); // 扇形攻击的掷骰记录
    }
}
exports.GameStateSchema = GameStateSchema;
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], GameStateSchema.prototype, "phase", void 0);
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], GameStateSchema.prototype, "currentPlayer", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "turn", void 0);
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], GameStateSchema.prototype, "player1General", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player1BaseQ", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player1BaseR", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player1BaseS", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player1Infantry", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player1Cavalry", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player1Archer", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player1ConsumedInfantry", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player1ConsumedCavalry", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player1ConsumedArcher", void 0);
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], GameStateSchema.prototype, "player2General", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player2BaseQ", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player2BaseR", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player2BaseS", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player2Infantry", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player2Cavalry", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player2Archer", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player2ConsumedInfantry", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player2ConsumedCavalry", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player2ConsumedArcher", void 0);
__decorate([
    (0, schema_1.type)({ map: UnitSchema }),
    __metadata("design:type", Object)
], GameStateSchema.prototype, "units", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player1Dice", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player2Dice", void 0);
__decorate([
    (0, schema_1.type)(["number"]),
    __metadata("design:type", Object)
], GameStateSchema.prototype, "player1DiceResults", void 0);
__decorate([
    (0, schema_1.type)(["number"]),
    __metadata("design:type", Object)
], GameStateSchema.prototype, "player2DiceResults", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player1ActionPoints", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player2ActionPoints", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player1TempMaxActionPoints", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player2TempMaxActionPoints", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player1KillDice", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player2KillDice", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player1LostDice", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player2LostDice", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player1RerollTokens", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player2RerollTokens", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player1DeployedValue", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "player2DeployedValue", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], GameStateSchema.prototype, "player1KilledThisTurn", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], GameStateSchema.prototype, "player2KilledThisTurn", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], GameStateSchema.prototype, "player1KilledLastTurn", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], GameStateSchema.prototype, "player2KilledLastTurn", void 0);
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], GameStateSchema.prototype, "selectedUnitId", void 0);
__decorate([
    (0, schema_1.type)(["string"]),
    __metadata("design:type", Object)
], GameStateSchema.prototype, "battleLog", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], GameStateSchema.prototype, "wushuangFanAttackActive", void 0);
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], GameStateSchema.prototype, "wushuangAttackingPlayer", void 0);
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], GameStateSchema.prototype, "wushuangAttackPhase", void 0);
__decorate([
    (0, schema_1.type)("number"),
    __metadata("design:type", Number)
], GameStateSchema.prototype, "wushuangSelectedDirection", void 0);
__decorate([
    (0, schema_1.type)(["number"]),
    __metadata("design:type", Object)
], GameStateSchema.prototype, "wushuangDiceRolls", void 0);
