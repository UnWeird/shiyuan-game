"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShiyuanRoom = void 0;
const core_1 = require("@colyseus/core");
const GameState_1 = require("../schema/GameState");
// 导入共享的六边形工具函数
const hexUtils_1 = require("../../../shared/utils/hexUtils");
/**
 * 十元（Shiyuan）游戏房间
 * 处理2名玩家的回合制对战 + 无限观战者
 */
class ShiyuanRoom extends core_1.Room {
    constructor() {
        super(...arguments);
        this.maxClients = 100; // 2名玩家 + 最多98名观战者
        // 玩家角色映射
        this.playerRoles = new Map();
        this.spectators = new Set(); // 观战者集合
    }
    onCreate(options) {
        this.setState(new GameState_1.GameStateSchema());
        console.log("🎮 十元游戏房间创建成功！Room ID:", this.roomId);
        // 注册消息处理器
        this.registerMessageHandlers();
        // 设置房间元数据（用于大厅显示）
        this.setMetadata({
            gameName: "十元",
            players: 0,
            maxPlayers: 2,
            status: "waiting"
        });
    }
    onJoin(client, options) {
        const isSpectator = options.spectator === true;
        // 计算当前玩家数量（不包括观战者）
        const playerCount = Array.from(this.playerRoles.values()).filter(role => role !== 'spectator').length;
        if (isSpectator || playerCount >= 2) {
            // 作为观战者加入
            this.playerRoles.set(client.sessionId, 'spectator');
            this.spectators.add(client.sessionId);
            client.send("role", { role: "spectator", message: "你是观战者" });
            console.log(`👁️  观战者加入: ${client.sessionId} (观战者数: ${this.spectators.size})`);
            // 通知所有人有观战者加入
            this.broadcast("spectatorJoined", {
                spectatorCount: this.spectators.size,
                message: "有观战者加入"
            }, { except: client });
        }
        else if (playerCount === 0) {
            // 第一个玩家
            this.playerRoles.set(client.sessionId, 'player1');
            client.send("role", { role: "player1", message: "你是玩家1" });
            console.log(`👤 玩家1加入: ${client.sessionId}`);
        }
        else if (playerCount === 1) {
            // 第二个玩家
            this.playerRoles.set(client.sessionId, 'player2');
            client.send("role", { role: "player2", message: "你是玩家2" });
            console.log(`👤 玩家2加入: ${client.sessionId}`);
            // 两个玩家都到齐，游戏开始！
            this.broadcast("gameStart", {
                message: "游戏开始！请选择你的将领"
            });
            // 更新房间元数据
            this.setMetadata({
                gameName: "十元",
                players: 2,
                maxPlayers: 2,
                status: "playing",
                spectators: this.spectators.size
            });
        }
    }
    onLeave(client, consented) {
        const role = this.playerRoles.get(client.sessionId);
        console.log(`👋 ${role} 离开房间 (consented: ${consented})`);
        // 如果不是主动离开（consented=false），允许60秒内重连
        if (!consented) {
            console.log(`⏳ ${role} 可能会重连，允许60秒内重连`);
            // 允许重连（60秒内）
            try {
                this.allowReconnection(client, 60);
            }
            catch (error) {
                console.error('❌ 设置重连失败:', error);
            }
            return;
        }
        // 主动离开，删除角色信息
        this.playerRoles.delete(client.sessionId);
        // 如果是观战者离开
        if (role === 'spectator') {
            this.spectators.delete(client.sessionId);
            console.log(`👁️  观战者离开 (剩余: ${this.spectators.size})`);
            return;
        }
        // 如果游戏进行中玩家离开，通知另一方
        if (this.state.phase !== "general_select" && this.state.phase !== "end") {
            this.broadcast("playerLeft", {
                role,
                message: `${role} 离开了游戏`
            });
        }
    }
    async onReconnection(client, previousSessionId) {
        console.log(`🔄 玩家重连: ${client.sessionId} (之前的 sessionId: ${previousSessionId})`);
        // 查找之前的角色
        const role = this.playerRoles.get(previousSessionId);
        if (role) {
            // 更新 sessionId（新的 sessionId，但角色不变）
            this.playerRoles.delete(previousSessionId);
            this.playerRoles.set(client.sessionId, role);
            // 如果是观战者
            if (role === 'spectator') {
                this.spectators.delete(previousSessionId);
                this.spectators.add(client.sessionId);
            }
            // 通知客户端恢复角色
            client.send("role", {
                role,
                message: `重连成功！你是${role === 'spectator' ? '观战者' : role}`
            });
            console.log(`✅ ${role} 重连成功`);
            // 通知其他玩家
            this.broadcast("info", {
                message: `${role} 重新连接`
            }, { except: client });
        }
        else {
            console.log(`❌ 未找到重连角色信息`);
        }
    }
    onDispose() {
        console.log("🗑️  房间被销毁:", this.roomId);
    }
    /**
     * 注册所有消息处理器
     */
    registerMessageHandlers() {
        // === 前置阶段 ===
        this.onMessage("selectGeneral", (client, data) => {
            this.handleSelectGeneral(client, data);
        });
        this.onMessage("buildArmy", (client, data) => {
            this.handleBuildArmy(client, data);
        });
        this.onMessage("setupBase", (client, data) => {
            this.handleSetupBase(client, data);
        });
        // === 部署阶段 ===
        this.onMessage("deployUnit", (client, data) => {
            this.handleDeployUnit(client, data);
        });
        this.onMessage("finishDeploy", (client, data) => {
            this.handleFinishDeploy(client);
        });
        // === 行动阶段 ===
        this.onMessage("rollDice", (client, data) => {
            this.handleRollDice(client);
        });
        this.onMessage("rerollDice", (client, data) => {
            this.handleRerollDice(client, data);
        });
        this.onMessage("moveUnit", (client, data) => {
            this.handleMoveUnit(client, data);
        });
        this.onMessage("attackUnit", (client, data) => {
            this.handleAttackUnit(client, data);
        });
        this.onMessage("rotateUnit", (client, data) => {
            this.handleRotateUnit(client, data);
        });
        this.onMessage("endTurn", (client, data) => {
            this.handleEndTurn(client);
        });
        // === 无双将军扇形攻击 ===
        this.onMessage("wushuangFanAttackStart", (client, data) => {
            this.handleWushuangFanAttackStart(client);
        });
        this.onMessage("wushuangSelectDirection", (client, data) => {
            this.handleWushuangSelectDirection(client, data);
        });
        this.onMessage("wushuangExecuteAttack", (client, data) => {
            this.handleWushuangExecuteAttack(client);
        });
        this.onMessage("wushuangSecondRoll", (client, data) => {
            this.handleWushuangSecondRoll(client);
        });
        this.onMessage("wushuangThirdRoll", (client, data) => {
            this.handleWushuangThirdRoll(client);
        });
        this.onMessage("wushuangCancel", (client, data) => {
            this.handleWushuangCancel(client);
        });
        // === 无双将军一次性技能 ===
        this.onMessage("wushuangAbility", (client, data) => {
            this.handleWushuangAbility(client);
        });
        // === 神机将军技能 ===
        this.onMessage("shenjiDeployMachine", (client, data) => {
            this.handleShenjiDeployMachine(client, data);
        });
        this.onMessage("shenjiModifyDice", (client, data) => {
            this.handleShenjiModifyDice(client, data);
        });
        // === 弩车攻击 ===
        this.onMessage("ballistaPierceAttack", (client, data) => {
            this.handleBallistaPierceAttack(client, data);
        });
        this.onMessage("ballistaMeleeAttack", (client, data) => {
            this.handleBallistaMeleeAttack(client, data);
        });
        // === 仁德将军技能 ===
        this.onMessage("rendeConvertAdjacent", (client, data) => {
            this.handleRendeConvertAdjacent(client);
        });
        this.onMessage("rendeConvertToInfantry", (client, data) => {
            this.handleRendeConvertToInfantry(client, data);
        });
        this.onMessage("rendeCompleteKill", (client, data) => {
            this.handleRendeCompleteKill(client, data);
        });
        this.onMessage("rendeSpareAsNeutral", (client, data) => {
            this.handleRendeSpareAsNeutral(client, data);
        });
        this.onMessage("surrender", (client) => {
            this.handleSurrender(client);
        });
    }
    /**
     * 获取客户端的玩家角色
     */
    getPlayerRole(client) {
        const role = this.playerRoles.get(client.sessionId);
        // 观战者返回 null，只有玩家可以操作
        return (role === 'player1' || role === 'player2') ? role : null;
    }
    /**
     * 添加战斗日志
     */
    addBattleLog(message) {
        this.state.battleLog.push(message);
        // 只保留最近20条日志
        if (this.state.battleLog.length > 20) {
            this.state.battleLog.shift();
        }
    }
    // ========================================
    // 游戏逻辑处理器
    // ========================================
    /**
     * 处理选择将领
     */
    handleSelectGeneral(client, data) {
        const role = this.getPlayerRole(client);
        if (!role)
            return;
        // 验证阶段
        if (this.state.phase !== "general_select") {
            client.send("error", { message: "当前不是选将阶段" });
            return;
        }
        // 设置将领
        if (role === "player1") {
            if (this.state.player1General) {
                client.send("error", { message: "已经选择过将领了" });
                return;
            }
            this.state.player1General = data.general;
            this.addBattleLog(`玩家1选择了${this.getGeneralName(data.general)}将军`);
        }
        else {
            if (this.state.player2General) {
                client.send("error", { message: "已经选择过将领了" });
                return;
            }
            this.state.player2General = data.general;
            this.addBattleLog(`玩家2选择了${this.getGeneralName(data.general)}将军`);
        }
        // 检查是否都选完了
        if (this.state.player1General && this.state.player2General) {
            this.state.phase = "army_build";
            this.addBattleLog("进入配兵阶段");
            this.broadcast("phaseChange", { phase: "army_build" });
        }
    }
    /**
     * 处理配兵
     */
    handleBuildArmy(client, data) {
        const role = this.getPlayerRole(client);
        if (!role)
            return;
        if (this.state.phase !== "army_build") {
            client.send("error", { message: "当前不是配兵阶段" });
            return;
        }
        // 验证预算（4元 = 40角）
        const cost = data.infantry * 1 + data.cavalry * 2 + data.archer * 5;
        if (cost !== 40) {
            client.send("error", { message: `预算必须是4元（40角），当前是${cost / 10}元` });
            return;
        }
        if (role === "player1") {
            if (this.state.player1Infantry > 0 || this.state.player1Cavalry > 0 || this.state.player1Archer > 0) {
                client.send("error", { message: "已经配置过部队了" });
                return;
            }
            this.state.player1Infantry = data.infantry;
            this.state.player1Cavalry = data.cavalry;
            this.state.player1Archer = data.archer;
            this.addBattleLog(`玩家1：步兵×${data.infantry} 骑兵×${data.cavalry} 弓手×${data.archer}`);
        }
        else {
            if (this.state.player2Infantry > 0 || this.state.player2Cavalry > 0 || this.state.player2Archer > 0) {
                client.send("error", { message: "已经配置过部队了" });
                return;
            }
            this.state.player2Infantry = data.infantry;
            this.state.player2Cavalry = data.cavalry;
            this.state.player2Archer = data.archer;
            this.addBattleLog(`玩家2：步兵×${data.infantry} 骑兵×${data.cavalry} 弓手×${data.archer}`);
        }
        // 检查是否都配完了（两个玩家都必须有至少一个兵种大于0）
        const player1Done = this.state.player1Infantry > 0 || this.state.player1Cavalry > 0 || this.state.player1Archer > 0;
        const player2Done = this.state.player2Infantry > 0 || this.state.player2Cavalry > 0 || this.state.player2Archer > 0;
        if (player1Done && player2Done) {
            this.state.phase = "base_setup";
            this.addBattleLog("进入大本营设置阶段");
            this.broadcast("phaseChange", { phase: "base_setup" });
        }
    }
    /**
     * 处理设置大本营
     */
    handleSetupBase(client, data) {
        const role = this.getPlayerRole(client);
        if (!role)
            return;
        if (this.state.phase !== "base_setup") {
            client.send("error", { message: "当前不是设置大本营阶段" });
            return;
        }
        // TODO: 验证位置是否在起始区
        if (role === "player1") {
            if (this.state.player1BaseQ !== 0 || this.state.player1BaseR !== 0) {
                client.send("error", { message: "已经设置过大本营了" });
                return;
            }
            this.state.player1BaseQ = data.q;
            this.state.player1BaseR = data.r;
            this.state.player1BaseS = data.s;
            this.addBattleLog(`玩家1设置大本营于(${data.q},${data.r},${data.s})`);
        }
        else {
            if (this.state.player2BaseQ !== 0 || this.state.player2BaseR !== 0) {
                client.send("error", { message: "已经设置过大本营了" });
                return;
            }
            this.state.player2BaseQ = data.q;
            this.state.player2BaseR = data.r;
            this.state.player2BaseS = data.s;
            this.addBattleLog(`玩家2设置大本营于(${data.q},${data.r},${data.s})`);
        }
        // 检查是否都设置完了（两个玩家的坐标都不为初始值）
        const player1Done = this.state.player1BaseQ !== 0 || this.state.player1BaseR !== 0;
        const player2Done = this.state.player2BaseQ !== 0 || this.state.player2BaseR !== 0;
        if (player1Done && player2Done) {
            this.state.phase = "deploy";
            this.addBattleLog("进入部署阶段 - 玩家1先部署");
            this.broadcast("phaseChange", { phase: "deploy" });
        }
    }
    /**
     * 处理部署单位
     */
    handleDeployUnit(client, data) {
        const role = this.getPlayerRole(client);
        if (!role)
            return;
        // 允许在部署阶段和行动阶段部署
        if (this.state.phase !== "deploy" && this.state.phase !== "action") {
            client.send("error", { message: "当前不能部署单位" });
            return;
        }
        // 验证是否是当前玩家
        if (role !== this.state.currentPlayer) {
            client.send("error", { message: "不是你的回合" });
            return;
        }
        // 检查行动点是否足够（部署消耗1点行动点）
        const currentActionPoints = role === "player1" ? this.state.player1ActionPoints : this.state.player2ActionPoints;
        if (currentActionPoints < 1) {
            client.send("error", { message: "行动点不足，无法部署" });
            return;
        }
        const { unitType, position, direction } = data;
        // 检查位置是否已被占用（包括单位本身和机关单位占据的格子）
        const posKey = `${position.q},${position.r},${position.s}`;
        const occupied = Array.from(this.state.units.values()).some(u => u.q === position.q && u.r === position.r && u.s === position.s);
        if (occupied) {
            client.send("error", { message: "该位置已被占用" });
            return;
        }
        // 检查是否被机关单位占据
        if (this.isHexOccupiedByMachine(position)) {
            client.send("error", { message: "该位置被机关单位占据，无法部署" });
            return;
        }
        // TODO: 验证位置是否在起始区
        // 验证库存：检查是否还有该类型的单位可以部署（基于已消耗库存而非场上数量）
        if (unitType === "infantry" || unitType === "cavalry" || unitType === "archer") {
            // 获取该玩家该类型单位的已消耗库存和配置上限
            let consumedCount = 0;
            let maxCount = 0;
            if (role === "player1") {
                if (unitType === "infantry") {
                    consumedCount = this.state.player1ConsumedInfantry;
                    maxCount = this.state.player1Infantry;
                }
                else if (unitType === "cavalry") {
                    consumedCount = this.state.player1ConsumedCavalry;
                    maxCount = this.state.player1Cavalry;
                }
                else if (unitType === "archer") {
                    consumedCount = this.state.player1ConsumedArcher;
                    maxCount = this.state.player1Archer;
                }
            }
            else {
                if (unitType === "infantry") {
                    consumedCount = this.state.player2ConsumedInfantry;
                    maxCount = this.state.player2Infantry;
                }
                else if (unitType === "cavalry") {
                    consumedCount = this.state.player2ConsumedCavalry;
                    maxCount = this.state.player2Cavalry;
                }
                else if (unitType === "archer") {
                    consumedCount = this.state.player2ConsumedArcher;
                    maxCount = this.state.player2Archer;
                }
            }
            // 检查是否超过库存：剩余 = 配置上限 - 已消耗
            if (consumedCount >= maxCount) {
                client.send("error", { message: `${unitType}单位库存已耗尽，无法部署` });
                return;
            }
        }
        // 将军只能部署一个
        if (unitType === "general") {
            const hasGeneral = Array.from(this.state.units.values()).some(u => u.owner === role && u.type === "general");
            if (hasGeneral) {
                client.send("error", { message: "将军已部署，不能重复部署" });
                return;
            }
        }
        // 创建单位
        const unit = new GameState_1.UnitSchema();
        unit.id = `unit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        unit.type = unitType;
        unit.owner = role;
        unit.q = position.q;
        unit.r = position.r;
        unit.s = position.s;
        unit.direction = direction || 0;
        // 设置HP和maxHp（所有单位都是2血）
        unit.hp = 2;
        unit.maxHp = 2;
        // 将军专属字段
        if (unitType === "general") {
            const generalType = role === "player1" ? this.state.player1General : this.state.player2General;
            unit.generalType = generalType;
            unit.abilityUsed = false;
            unit.isInvincible = false;
            unit.unlimitedActions = false;
            unit.hasFanAttacked = false;
            unit.bonusActionLimit = 0;
            unit.canConvertNeutral = generalType === "rende";
            unit.convertInfantryCost = 1; // 仁德将军初始转化费用为1
            // 根据将军类型设置maxHp
            if (generalType === "wushuang") {
                unit.maxHp = 4;
                unit.hp = 4;
            }
            else {
                unit.maxHp = 3;
                unit.hp = 3;
            }
        }
        // 添加到地图
        this.state.units.set(unit.id, unit);
        // 增加已消耗库存（只对三个基础兵种）
        if (unitType === "infantry" || unitType === "cavalry" || unitType === "archer") {
            if (role === "player1") {
                if (unitType === "infantry") {
                    this.state.player1ConsumedInfantry++;
                }
                else if (unitType === "cavalry") {
                    this.state.player1ConsumedCavalry++;
                }
                else if (unitType === "archer") {
                    this.state.player1ConsumedArcher++;
                }
            }
            else {
                if (unitType === "infantry") {
                    this.state.player2ConsumedInfantry++;
                }
                else if (unitType === "cavalry") {
                    this.state.player2ConsumedCavalry++;
                }
                else if (unitType === "archer") {
                    this.state.player2ConsumedArcher++;
                }
            }
        }
        // 扣除行动点
        if (role === "player1") {
            this.state.player1ActionPoints -= 1;
        }
        else {
            this.state.player2ActionPoints -= 1;
        }
        this.addBattleLog(`${role === "player1" ? "玩家1" : "玩家2"}部署了${unitType}于(${position.q},${position.r},${position.s})`);
        client.send("info", { message: "部署成功" });
        // 累加部署价值（不会因单位死亡而减少）
        const unitValue = this.getUnitValue(unitType);
        if (role === "player1") {
            this.state.player1DeployedValue += unitValue;
        }
        else {
            this.state.player2DeployedValue += unitValue;
        }
        // 注意：部署阶段不自动切换回合，即使行动点耗尽也要等玩家手动点击"结束回合"
    }
    /**
     * 获取单位价值（元）
     */
    getUnitValue(unitType) {
        if (unitType === "infantry")
            return 0.1;
        if (unitType === "cavalry")
            return 0.2;
        if (unitType === "archer")
            return 0.5;
        if (unitType === "ballista")
            return 0.9;
        if (unitType === "chariot")
            return 0.6;
        return 0; // 将军不计入
    }
    /**
     * 处理完成部署
     */
    handleFinishDeploy(client) {
        const role = this.getPlayerRole(client);
        if (!role || role !== this.state.currentPlayer)
            return;
        // 切换到另一个玩家部署
        if (this.state.currentPlayer === "player1") {
            // 玩家1完成部署，轮到玩家2
            this.state.currentPlayer = "player2";
            this.addBattleLog("玩家1完成部署，轮到玩家2");
            // 重置玩家1的行动点（先手部署阶段不需要行动点）
            this.state.player1ActionPoints = 0;
        }
        else {
            // 玩家2完成部署，进入行动阶段
            this.state.phase = "action";
            this.state.currentPlayer = "player1";
            this.state.player2ActionPoints = 0; // 重置玩家2行动点
            // 重置所有单位的行动标记（部署阶段的行动不影响行动阶段）
            this.state.units.forEach((unit) => {
                unit.hasMoved = false;
                unit.hasAttacked = false;
                unit.hasRotated = false;
                unit.actionsThisTurn = 0;
                if (unit.type === "ballista" || unit.type === "chariot") {
                    unit.hasActedThisTurn = false;
                }
            });
            this.addBattleLog("部署完成！进入第1回合");
            this.broadcast("phaseChange", { phase: "action" });
            // 自动为玩家1投骰子开始第一回合
            this.rollDiceForPlayer("player1");
        }
    }
    /**
     * 处理投骰子
     */
    handleRollDice(client) {
        const role = this.getPlayerRole(client);
        if (!role || role !== this.state.currentPlayer) {
            client.send("error", { message: "不是你的回合" });
            return;
        }
        // 部署阶段的特殊规则
        if (this.state.phase === "deploy") {
            if (role === "player1") {
                // 玩家1（先手）在部署阶段不需要投骰子，给予足够的行动点用于部署
                this.state.player1ActionPoints = 999; // 无限行动点
                this.addBattleLog("玩家1开始部署（不限次数）");
                return;
            }
            else {
                // 玩家2（后手）骰子数 = 1 + 玩家1已部署单位总价值（元）的整数部分
                const deployedValue = this.state.player1DeployedValue;
                const diceCount = 1 + Math.floor(deployedValue); // 基础1颗 + 每1元1颗
                // 投骰子
                const results = [];
                for (let i = 0; i < diceCount; i++) {
                    results.push(Math.floor(Math.random() * 6) + 1);
                }
                const totalPoints = results.reduce((sum, val) => sum + val, 0);
                this.state.player2Dice = diceCount;
                this.state.player2DiceResults.clear();
                results.forEach(r => this.state.player2DiceResults.push(r));
                this.state.player2ActionPoints = totalPoints;
                this.addBattleLog(`玩家2投骰子：${diceCount}颗骰子（基础1+玩家1部署${deployedValue.toFixed(1)}元），点数${results.join(',')}，共${totalPoints}点行动值`);
                return;
            }
        }
        // 行动阶段：调用独立的投骰子逻辑
        this.rollDiceForPlayer(role);
    }
    /**
     * 为指定玩家投骰子（行动阶段）
     */
    rollDiceForPlayer(role) {
        // 战斗阶段的骰子逻辑
        // 计算当前玩家的骰子数量：基础骰子(将军存活?1:0) + 每2元1颗
        const playerUnits = Array.from(this.state.units.values()).filter(u => u.owner === role);
        console.log(`\n=== 骰子计算调试 (${role}) ===`);
        console.log(`玩家单位数量: ${playerUnits.length}`);
        console.log(`单位类型:`, playerUnits.map(u => u.type));
        // 使用累计的部署价值（不会因单位死亡而减少）
        const deployedValue = role === "player1" ? this.state.player1DeployedValue : this.state.player2DeployedValue;
        console.log(`部署价值: ${deployedValue}元`);
        // 检查将军是否存活
        const generalAlive = playerUnits.some(u => u.type === "general");
        const baseDice = generalAlive ? 1 : 0;
        console.log(`将军存活: ${generalAlive}, 基础骰子: ${baseDice}`);
        console.log(`部署骰子: ${Math.floor(deployedValue / 2)}`);
        // 骰子数 = 基础骰子 + 每2元1颗
        // 注意：击杀奖励骰子是在击杀时立即投掷的，不在这里计算
        const diceCount = baseDice + Math.floor(deployedValue / 2);
        console.log(`最终骰子数: ${diceCount}`);
        console.log(`======================\n`);
        // 如果骰子数为0，玩家失败
        if (diceCount <= 0) {
            const winner = role === "player1" ? "player2" : "player1";
            this.state.phase = "end";
            this.addBattleLog(`${role === "player1" ? "玩家1" : "玩家2"}骰子数为0，游戏结束！`);
            this.addBattleLog(`${winner === "player1" ? "玩家1" : "玩家2"}获胜！`);
            this.broadcast("phaseChange", { phase: "end" });
            return;
        }
        // 投骰子（服务器生成随机数）
        const results = [];
        for (let i = 0; i < diceCount; i++) {
            results.push(Math.floor(Math.random() * 6) + 1); // 1-6
        }
        // 计算行动点
        const actionPoints = results.reduce((sum, val) => sum + val, 0);
        if (role === "player1") {
            this.state.player1Dice = diceCount;
            this.state.player1DiceResults.clear();
            results.forEach(r => this.state.player1DiceResults.push(r));
            this.state.player1ActionPoints = actionPoints;
        }
        else {
            this.state.player2Dice = diceCount;
            this.state.player2DiceResults.clear();
            results.forEach(r => this.state.player2DiceResults.push(r));
            this.state.player2ActionPoints = actionPoints;
        }
        this.addBattleLog(`${role === "player1" ? "玩家1" : "玩家2"}投骰：${diceCount}颗骰子(基础${baseDice}+部署${Math.floor(deployedValue / 2)})，点数${results.join(',')}，共${actionPoints}点行动值`);
    }
    /**
     * 处理重投骰子
     */
    handleRerollDice(client, data) {
        const role = this.getPlayerRole(client);
        if (!role || role !== this.state.currentPlayer)
            return;
        const tokens = role === "player1" ? this.state.player1RerollTokens : this.state.player2RerollTokens;
        if (tokens <= 0) {
            client.send("error", { message: "没有重投次数了" });
            return;
        }
        // 重投指定的骰子
        const newValue = Math.floor(Math.random() * 6) + 1;
        if (role === "player1") {
            const oldValue = this.state.player1DiceResults[data.diceIndex];
            this.state.player1DiceResults[data.diceIndex] = newValue;
            this.state.player1RerollTokens--;
            // 重新计算行动点
            this.state.player1ActionPoints = Array.from(this.state.player1DiceResults).reduce((sum, v) => sum + v, 0);
            this.addBattleLog(`玩家1重投：${oldValue}→${newValue}`);
        }
        else {
            const oldValue = this.state.player2DiceResults[data.diceIndex];
            this.state.player2DiceResults[data.diceIndex] = newValue;
            this.state.player2RerollTokens--;
            this.state.player2ActionPoints = Array.from(this.state.player2DiceResults).reduce((sum, v) => sum + v, 0);
            this.addBattleLog(`玩家2重投：${oldValue}→${newValue}`);
        }
    }
    /**
     * 检查一个格子是否被机关单位占据
     * 机关单位（弩车、战车）占据多个格子，任何一个格子都不能被其他单位通过或占用
     */
    isHexOccupiedByMachine(hex) {
        // 遍历所有单位，检查是否有机关单位占据了这个格子
        for (const unit of this.state.units.values()) {
            if (unit.type === 'ballista' || unit.type === 'chariot') {
                const machineType = unit.type === 'ballista' ? 'ballista' : 'chariot';
                const occupiedHexes = (0, hexUtils_1.getMachineOccupiedHexes)({ q: unit.q, r: unit.r, s: unit.s }, machineType);
                // 检查这个hex是否在机关单位占据的格子中
                if (occupiedHexes.some(occupiedHex => (0, hexUtils_1.hexEquals)(occupiedHex, hex))) {
                    return true;
                }
            }
        }
        return false;
    }
    /**
     * 计算单位的合法移动位置
     */
    getValidMoves(unit) {
        const MAP_RADIUS = 5;
        // 计算行动次数上限（基础2次 + 额外行动次数）
        const bonusActions = (unit.type === 'general' && unit.bonusActionLimit) ? unit.bonusActionLimit : 0;
        const actionLimit = 2 + bonusActions;
        // 检查是否已达到行动次数上限
        if (unit.actionsThisTurn >= actionLimit) {
            return [];
        }
        // 检查是否有无限行动标志（无双技能）
        const hasUnlimitedActions = unit.type === 'general' && unit.unlimitedActions;
        // 如果没有无限行动且没有额外行动次数，按照原来的规则：移动过就不能再移动
        if (!hasUnlimitedActions && bonusActions === 0 && unit.hasMoved) {
            return [];
        }
        const unitPos = { q: unit.q, r: unit.r, s: unit.s };
        // 战车特殊移动逻辑
        if (unit.type === 'chariot') {
            // 检查是否已行动
            if (unit.hasActedThisTurn)
                return [];
            // 根据玩家方向确定移动方向
            const dir1 = unit.owner === 'player1' ? 2 : 5; // NORTH_WEST : SOUTH_WEST
            const dir2 = unit.owner === 'player1' ? 1 : 4; // NORTH_EAST : SOUTH_EAST
            // 战车有3种移动终点：
            // 1. 正前方（先dir1后dir2）
            const mid_forward = (0, hexUtils_1.hexNeighbor)(unitPos, dir1);
            const end_forward = (0, hexUtils_1.hexNeighbor)(mid_forward, dir2);
            // 2. 左侧（两次dir1）
            const mid_left = (0, hexUtils_1.hexNeighbor)(unitPos, dir1);
            const end_left = (0, hexUtils_1.hexNeighbor)(mid_left, dir1);
            // 3. 右侧（两次dir2）
            const mid_right = (0, hexUtils_1.hexNeighbor)(unitPos, dir2);
            const end_right = (0, hexUtils_1.hexNeighbor)(mid_right, dir2);
            // 战车可以碾压敌人，检查每个终点的所有占用格子是否都在地图范围内
            const endpoints = [end_forward, end_left, end_right];
            return endpoints.filter(hex => {
                const occupiedHexes = (0, hexUtils_1.getMachineOccupiedHexes)(hex, 'chariot');
                return occupiedHexes.every(occupiedHex => (0, hexUtils_1.isInMapRange)(occupiedHex, MAP_RADIUS));
            });
        }
        // 弩车特殊移动逻辑：不能碾压，需要检查所有占用格子
        if (unit.type === 'ballista') {
            // 检查是否已行动
            if (unit.hasActedThisTurn)
                return [];
            const range = 1;
            const possibleMoves = (0, hexUtils_1.hexRange)(unitPos, range);
            // 过滤移动位置：需要检查弩车占用的所有5格都没有障碍物
            return possibleMoves.filter(hex => {
                if ((0, hexUtils_1.hexEquals)(hex, unitPos))
                    return false;
                // 检查目标位置及其占用的所有格子
                const targetOccupiedHexes = (0, hexUtils_1.getMachineOccupiedHexes)(hex, 'ballista');
                // 检查是否有任何格子被占用
                const hasCollision = targetOccupiedHexes.some(occupiedHex => {
                    let isOccupied = false;
                    this.state.units.forEach(u => {
                        if (u.id !== unit.id && (0, hexUtils_1.hexEquals)({ q: u.q, r: u.r, s: u.s }, occupiedHex)) {
                            isOccupied = true;
                        }
                    });
                    return isOccupied;
                });
                return !hasCollision && (0, hexUtils_1.hexDistance)(unitPos, hex) <= range;
            });
        }
        // 普通单位移动逻辑
        const range = unit.type === 'cavalry' ? 2 : 1;
        const possibleMoves = (0, hexUtils_1.hexRange)(unitPos, range);
        // 过滤掉已被占用的位置和不在地图范围内的位置
        return possibleMoves.filter(hex => {
            if ((0, hexUtils_1.hexEquals)(hex, unitPos))
                return false;
            // 检查是否有其他单位占用（包括单位本身和机关单位占据的格子）
            let occupied = false;
            this.state.units.forEach(u => {
                if ((0, hexUtils_1.hexEquals)({ q: u.q, r: u.r, s: u.s }, hex) && u.id !== unit.id) {
                    occupied = true;
                }
            });
            // 检查是否被机关单位占据（机关单位的所有格子都是实体）
            if (this.isHexOccupiedByMachine(hex)) {
                occupied = true;
            }
            return !occupied && (0, hexUtils_1.hexDistance)(unitPos, hex) <= range;
        });
    }
    /**
     * 通用：处理战车死亡，生成2个不可行动的步兵
     * @param chariot 被击杀的战车
     * @returns 是否成功处理（战车崩毁逻辑）
     */
    handleChariotDeath(chariot) {
        const chariotPos = { q: chariot.q, r: chariot.r, s: chariot.s };
        // 战车崩毁：如果击杀过敌人，神机将军拥有者获得重投机会
        if (chariot.killCount > 0) {
            if (chariot.owner === "player1") {
                this.state.player1RerollTokens++;
            }
            else {
                this.state.player2RerollTokens++;
            }
            this.addBattleLog(`战车崩毁，${chariot.owner === "player1" ? "玩家1" : "玩家2"}获得1次重投机会`);
        }
        // 战车崩毁后，原地生成2个满血步兵（不可行动）
        const infantry1 = new GameState_1.UnitSchema();
        infantry1.id = `unit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        infantry1.type = "infantry";
        infantry1.owner = chariot.owner;
        infantry1.q = chariotPos.q;
        infantry1.r = chariotPos.r;
        infantry1.s = chariotPos.s;
        infantry1.direction = chariot.direction;
        infantry1.hp = 2;
        infantry1.maxHp = 2;
        infantry1.hasMoved = true; // 本回合不能再移动
        infantry1.hasActedThisTurn = true; // 本回合不能再行动
        infantry1.actionsThisTurn = 1;
        this.state.units.set(infantry1.id, infantry1);
        // 第二个步兵：寻找相邻空位
        const neighbors = (0, hexUtils_1.hexNeighbors)(chariotPos);
        const emptyPos = neighbors.find((pos) => {
            // 检查是否有单位占用
            const occupied = Array.from(this.state.units.values()).some(u => u.q === pos.q && u.r === pos.r && u.s === pos.s);
            // 检查是否被机关单位占据
            const occupiedByMachine = this.isHexOccupiedByMachine(pos);
            return !occupied && !occupiedByMachine && (0, hexUtils_1.isInMapRange)(pos, 5);
        });
        if (emptyPos) {
            const infantry2 = new GameState_1.UnitSchema();
            infantry2.id = `unit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_2`;
            infantry2.type = "infantry";
            infantry2.owner = chariot.owner;
            infantry2.q = emptyPos.q;
            infantry2.r = emptyPos.r;
            infantry2.s = emptyPos.s;
            infantry2.direction = chariot.direction;
            infantry2.hp = 2;
            infantry2.maxHp = 2;
            infantry2.hasMoved = true; // 本回合不能再移动
            infantry2.hasActedThisTurn = true; // 本回合不能再行动
            infantry2.actionsThisTurn = 1;
            this.state.units.set(infantry2.id, infantry2);
            this.addBattleLog(`战车崩毁为2个满血步兵`);
        }
        else {
            this.addBattleLog(`战车崩毁为1个满血步兵（无相邻空位）`);
        }
    }
    /**
     * 处理移动单位
     */
    handleMoveUnit(client, data) {
        const role = this.getPlayerRole(client);
        if (!role || role !== this.state.currentPlayer) {
            client.send("error", { message: "不是你的回合" });
            return;
        }
        const unit = this.state.units.get(data.unitId);
        if (!unit || unit.owner !== role) {
            client.send("error", { message: "这不是你的单位" });
            return;
        }
        // 检查弓兵行动次数上限（2次）
        if (unit.type === 'archer' && unit.actionsThisTurn >= 2) {
            client.send("error", { message: "该单位本回合已达行动次数上限" });
            return;
        }
        // 验证移动合法性
        const validMoves = this.getValidMoves(unit);
        const targetPos = { q: data.toQ, r: data.toR, s: data.toS };
        const isValidMove = validMoves.some(hex => (0, hexUtils_1.hexEquals)(hex, targetPos));
        if (!isValidMove) {
            client.send("error", { message: "非法移动：目标位置不可达" });
            return;
        }
        // 扣除行动点（暂定1点）
        if (role === "player1") {
            if (this.state.player1ActionPoints < 1) {
                client.send("error", { message: "行动点不足" });
                return;
            }
            this.state.player1ActionPoints--;
        }
        else {
            if (this.state.player2ActionPoints < 1) {
                client.send("error", { message: "行动点不足" });
                return;
            }
            this.state.player2ActionPoints--;
        }
        // 执行移动
        unit.q = data.toQ;
        unit.r = data.toR;
        unit.s = data.toS;
        unit.hasMoved = true;
        unit.actionsThisTurn = (unit.actionsThisTurn || 0) + 1; // 增加行动次数
        // 机关单位（弩车、战车）需要标记已行动
        if (unit.type === 'ballista' || unit.type === 'chariot') {
            unit.hasActedThisTurn = true;
        }
        this.addBattleLog(`${role}移动${unit.type}到(${data.toQ},${data.toR},${data.toS})`);
        console.log(`[DEBUG] 移动前 - currentPlayer: ${this.state.currentPlayer}, role: ${role}, unit.owner: ${unit.owner}, unit.type: ${unit.type}, unit.id: ${unit.id}`);
        // 战车碾压：检查移动路径上是否有敌方单位
        if (unit.type === 'chariot') {
            const chariotOccupiedHexes = (0, hexUtils_1.getMachineOccupiedHexes)(targetPos, 'chariot');
            // 查找所有被战车占据格子上的敌方单位（包括机关单位的体积）
            const crushedUnits = [];
            const crushedMachines = []; // 记录被碾压的机关单位
            chariotOccupiedHexes.forEach(hex => {
                // 检查普通单位和将军
                const enemyUnit = Array.from(this.state.units.values()).find(u => u.owner !== role && u.q === hex.q && u.r === hex.r && u.s === hex.s);
                if (enemyUnit && !crushedUnits.includes(enemyUnit)) {
                    crushedUnits.push(enemyUnit);
                }
                // 检查机关单位的体积
                Array.from(this.state.units.values()).forEach(u => {
                    if (u.owner !== role && (u.type === 'ballista' || u.type === 'chariot')) {
                        const machineType = u.type === 'ballista' ? 'ballista' : 'chariot';
                        const machineOccupiedHexes = (0, hexUtils_1.getMachineOccupiedHexes)({ q: u.q, r: u.r, s: u.s }, machineType);
                        const isCrushed = machineOccupiedHexes.some(machineHex => (0, hexUtils_1.hexEquals)(machineHex, hex));
                        if (isCrushed && !crushedMachines.includes(u) && !crushedUnits.includes(u)) {
                            crushedMachines.push(u);
                            crushedUnits.push(u);
                        }
                    }
                });
            });
            // 如果碾压到机关单位，处理机关崩解
            if (crushedMachines.length > 0) {
                // 碾压方的战车先崩解（步兵优先占据原位）
                this.handleChariotDeath(unit);
                this.state.units.delete(unit.id);
                this.addBattleLog(`战车碾压到机关单位，崩解！`);
                // 再处理被碾压的战车的崩解（如果有）
                crushedMachines.forEach(crushedMachine => {
                    if (crushedMachine.type === 'chariot') {
                        // 被碾压的战车崩解为2个不可行动的步兵
                        this.handleChariotDeath(crushedMachine);
                        this.state.units.delete(crushedMachine.id);
                        this.addBattleLog(`${crushedMachine.owner}的战车被碾压，崩解！`);
                    }
                    else {
                        // 弩车直接删除
                        this.state.units.delete(crushedMachine.id);
                        this.addBattleLog(`战车碾压击杀了${crushedMachine.owner}的${crushedMachine.type}！`);
                    }
                });
                // 战车已崩解，不继续后续逻辑
                return;
            }
            // 对每个被碾压的普通单位：直接击杀，战车扣1点血
            crushedUnits.forEach(crushedUnit => {
                // 直接击杀被碾压的单位
                this.state.units.delete(crushedUnit.id);
                this.addBattleLog(`战车碾压击杀了${crushedUnit.owner}的${crushedUnit.type}！`);
                // 如果是击杀敌方单位，战车killCount+1
                if (crushedUnit.owner !== role) {
                    unit.killCount++;
                }
                // 战车自己扣1点血
                unit.hp -= 1;
                // 如果是击杀将军，永久减少对方骰子数
                if (crushedUnit.type === "general") {
                    if (crushedUnit.owner === "player1") {
                        this.state.player1Dice = Math.max(0, this.state.player1Dice - 1);
                        this.state.player1LostDice++;
                    }
                    else {
                        this.state.player2Dice = Math.max(0, this.state.player2Dice - 1);
                        this.state.player2LostDice++;
                    }
                    this.addBattleLog(`${crushedUnit.owner}的将军被击杀，永久失去1颗骰子！`);
                }
                // 首次击杀奖励（只对敌方单位）
                if (crushedUnit.owner !== role) {
                    if (role === "player1" && !this.state.player1KilledThisTurn) {
                        this.state.player1KilledThisTurn = true;
                        this.state.player1KillDice++;
                        const extraRoll = Math.floor(Math.random() * 6) + 1;
                        this.state.player1Dice++;
                        this.state.player1DiceResults.push(extraRoll);
                        this.state.player1ActionPoints += extraRoll;
                        this.addBattleLog(`玩家1首次击杀！获得额外骰子，投出${extraRoll}点`);
                    }
                    else if (role === "player2" && !this.state.player2KilledThisTurn) {
                        this.state.player2KilledThisTurn = true;
                        this.state.player2KillDice++;
                        const extraRoll = Math.floor(Math.random() * 6) + 1;
                        this.state.player2Dice++;
                        this.state.player2DiceResults.push(extraRoll);
                        this.state.player2ActionPoints += extraRoll;
                        this.addBattleLog(`玩家2首次击杀！获得额外骰子，投出${extraRoll}点`);
                    }
                }
            });
            // 检查战车是否因为碾压而崩毁（血量≤0）
            if (unit.hp <= 0) {
                console.log(`[DEBUG] 战车血量耗尽，开始崩毁流程`);
                this.handleChariotDeath(unit);
                this.state.units.delete(unit.id);
                this.addBattleLog(`战车血量耗尽，崩毁！`);
                // 战车已崩毁，不继续后续逻辑（避免重复触发触底逻辑）
                return;
            }
        }
        console.log(`[DEBUG] 移动结束 - currentPlayer: ${this.state.currentPlayer}, role: ${role}`);
        // 检查胜利条件：是否触碰到敌方大本营
        this.checkVictoryCondition(unit);
    }
    /**
     * 检查胜利条件和战车触底
     */
    checkVictoryCondition(unit) {
        console.log(`[DEBUG checkVictoryCondition] 检查单位: type=${unit.type}, owner=${unit.owner}, pos=(${unit.q},${unit.r},${unit.s})`);
        // 获取敌方大本营位置
        const enemyBaseQ = unit.owner === "player1" ? this.state.player2BaseQ : this.state.player1BaseQ;
        const enemyBaseR = unit.owner === "player1" ? this.state.player2BaseR : this.state.player1BaseR;
        const enemyBaseS = unit.owner === "player1" ? this.state.player2BaseS : this.state.player1BaseS;
        const enemyBase = { q: enemyBaseQ, r: enemyBaseR, s: enemyBaseS };
        console.log(`[DEBUG checkVictoryCondition] 敌方大本营位置: (${enemyBaseQ},${enemyBaseR},${enemyBaseS})`);
        // 检查单位是否触碰到敌方大本营（游戏胜利）
        let reachedBase = false;
        if (unit.type === 'ballista' || unit.type === 'chariot') {
            const machineType = unit.type === 'ballista' ? 'ballista' : 'chariot';
            const occupiedHexes = (0, hexUtils_1.getMachineOccupiedHexes)({ q: unit.q, r: unit.r, s: unit.s }, machineType);
            console.log(`[DEBUG checkVictoryCondition] 机关单位占用格子:`, occupiedHexes);
            reachedBase = occupiedHexes.some(hex => (0, hexUtils_1.hexEquals)(hex, enemyBase));
        }
        else {
            // 普通单位：检查单位本身的位置
            reachedBase = unit.q === enemyBaseQ && unit.r === enemyBaseR && unit.s === enemyBaseS;
        }
        console.log(`[DEBUG checkVictoryCondition] 触碰大本营=${reachedBase}`);
        if (reachedBase) {
            // 任何单位触碰到敌方大本营，游戏胜利
            const winner = unit.owner === "player1" ? "玩家1" : "玩家2";
            this.addBattleLog(`${winner}的${unit.type}触碰到敌方大本营！${winner}获胜！`);
            this.state.phase = "end";
            // 广播胜利消息
            this.broadcast("gameEnd", {
                winner: unit.owner,
                message: `${winner}获胜！`,
            });
            return;
        }
        // 战车特殊：检查是否触底（进入敌方部署区）
        if (unit.type === 'chariot') {
            // 玩家1的战车：进入player2的部署区（r <= -3）
            // 玩家2的战车：进入player1的部署区（r >= 3）
            const enemyDeployZone = unit.owner === "player1" ? (unit.r <= -3) : (unit.r >= 3);
            console.log(`[DEBUG checkVictoryCondition] 战车触底检测: r=${unit.r}, enemyDeployZone=${enemyDeployZone}`);
            if (enemyDeployZone) {
                console.log(`[DEBUG checkVictoryCondition] 战车触底！`);
                this.handleChariotReachEnemyZone(unit);
            }
        }
    }
    /**
     * 处理战车触底（到达敌方部署区）
     * 战车崩解为两个可行动的步兵，剩余血量转为行动点
     */
    handleChariotReachEnemyZone(chariot) {
        const role = chariot.owner;
        const chariotPos = { q: chariot.q, r: chariot.r, s: chariot.s };
        const remainingHp = chariot.hp;
        // 删除战车
        this.state.units.delete(chariot.id);
        this.addBattleLog(`战车触底！剩余${remainingHp}点血量转为${remainingHp}点行动值，崩解为2个可行动的步兵`);
        // 将剩余血量转为行动点
        if (role === "player1") {
            this.state.player1ActionPoints += remainingHp;
        }
        else {
            this.state.player2ActionPoints += remainingHp;
        }
        // 生成第一个步兵（原位置，可行动）
        const infantry1 = new GameState_1.UnitSchema();
        infantry1.id = `unit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        infantry1.type = "infantry";
        infantry1.owner = role;
        infantry1.q = chariotPos.q;
        infantry1.r = chariotPos.r;
        infantry1.s = chariotPos.s;
        infantry1.direction = chariot.direction;
        infantry1.hp = 2;
        infantry1.maxHp = 2;
        infantry1.hasMoved = false; // 可以移动
        infantry1.hasActedThisTurn = false;
        infantry1.actionsThisTurn = 0; // 未行动过
        this.state.units.set(infantry1.id, infantry1);
        // 生成第二个步兵（相邻位置，可行动）
        const neighbors = (0, hexUtils_1.hexNeighbors)(chariotPos);
        const emptyPos = neighbors.find((pos) => {
            const occupied = Array.from(this.state.units.values()).some(u => u.q === pos.q && u.r === pos.r && u.s === pos.s);
            const occupiedByMachine = this.isHexOccupiedByMachine(pos);
            return !occupied && !occupiedByMachine && (0, hexUtils_1.isInMapRange)(pos, 5);
        });
        if (emptyPos) {
            const infantry2 = new GameState_1.UnitSchema();
            infantry2.id = `unit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_2`;
            infantry2.type = "infantry";
            infantry2.owner = role;
            infantry2.q = emptyPos.q;
            infantry2.r = emptyPos.r;
            infantry2.s = emptyPos.s;
            infantry2.direction = chariot.direction;
            infantry2.hp = 2;
            infantry2.maxHp = 2;
            infantry2.hasMoved = false; // 可以移动
            infantry2.hasActedThisTurn = false;
            infantry2.actionsThisTurn = 0; // 未行动过
            this.state.units.set(infantry2.id, infantry2);
            this.addBattleLog(`战车触底崩解：生成2个满血可行动步兵，获得${remainingHp}点行动值`);
        }
        else {
            this.addBattleLog(`战车触底崩解：生成1个满血可行动步兵（无相邻空位），获得${remainingHp}点行动值`);
        }
    }
    /**
     * 处理攻击单位
     */
    handleAttackUnit(client, data) {
        const role = this.getPlayerRole(client);
        if (!role || role !== this.state.currentPlayer) {
            client.send("error", { message: "不是你的回合" });
            return;
        }
        const attacker = this.state.units.get(data.attackerId);
        const target = this.state.units.get(data.targetId);
        if (!attacker || !target) {
            client.send("error", { message: "单位不存在" });
            return;
        }
        if (attacker.owner !== role) {
            client.send("error", { message: "这不是你的单位" });
            return;
        }
        // 检查弓兵行动次数上限（2次）
        if (attacker.type === 'archer' && attacker.actionsThisTurn >= 2) {
            client.send("error", { message: "该单位本回合已达行动次数上限" });
            return;
        }
        // 计算行动点消耗：攻击将领消耗2点，其他单位消耗1点
        const actionCost = target.type === "general" ? 2 : 1;
        // 检查行动点是否足够
        if (role === "player1") {
            if (this.state.player1ActionPoints < actionCost) {
                client.send("error", { message: "行动点不足" });
                return;
            }
            this.state.player1ActionPoints -= actionCost;
        }
        else {
            if (this.state.player2ActionPoints < actionCost) {
                client.send("error", { message: "行动点不足" });
                return;
            }
            this.state.player2ActionPoints -= actionCost;
        }
        // TODO: 验证攻击范围、计算伤害
        // 计算伤害：
        // 1. 近战单位（步兵、骑兵、将军）攻击弩车：造成2点伤害
        // 2. 其他情况：造成1点伤害
        let damage = 1;
        if (target.type === "ballista") {
            // 步兵、骑兵、将军都是近战单位，攻击弩车造成2点伤害
            if (attacker.type === "infantry" || attacker.type === "cavalry" || attacker.type === "general") {
                damage = 2;
                console.log(`[DEBUG] ${attacker.type}近战攻击弩车，造成2点伤害`);
            }
        }
        target.hp -= damage;
        attacker.hasAttacked = true;
        attacker.actionsThisTurn = (attacker.actionsThisTurn || 0) + 1; // 增加行动次数
        this.addBattleLog(`${role}的${attacker.type}攻击了${target.owner}的${target.type}，造成${damage}点伤害（消耗${actionCost}点行动值）`);
        // 骑兵受伤后立即变成步兵（满血）
        if (target.type === "cavalry" && target.hp > 0) {
            console.log(`[DEBUG] 骑兵受伤，变成满血步兵`);
            target.type = "infantry";
            target.maxHp = 2;
            target.hp = 2; // 骑兵变步兵后是满血（2点）
            this.addBattleLog(`${target.owner}的骑兵受伤，变成满血步兵！`);
        }
        // 检查是否击杀
        if (target.hp <= 0) {
            // 检查是否是仁德阵营的击杀
            const rendeGeneral = Array.from(this.state.units.values()).find(u => u.owner === role && u.type === "general" && u.generalType === "rende");
            // 仁德阵营击杀非中立单位：发送确认请求给客户端
            if (rendeGeneral && target.type !== 'neutral_marker') {
                client.send("rendeKillConfirm", {
                    attackerId: attacker.id,
                    targetId: target.id,
                    targetType: target.type,
                    targetOwner: target.owner,
                });
                this.addBattleLog(`${role}的${attacker.type}即将击杀${target.owner}的${target.type}，等待仁德确认...`);
                return; // 不立即处理击杀，等待客户端确认
            }
            // 非仁德阵营 或 仁德击杀中立单位：直接击杀
            // 如果被击杀的是战车，先生成2个不可移动的步兵，再删除战车
            if (target.type === 'chariot') {
                this.handleChariotDeath(target);
                this.state.units.delete(data.targetId);
                this.addBattleLog(`${target.owner}的战车被击杀，崩毁！`);
            }
            else {
                // 非战车单位：直接击杀
                this.state.units.delete(data.targetId);
                this.addBattleLog(`${target.owner}的${target.type}被击杀！`);
            }
            // 如果击杀了中立标记，敌方仁德将军的转化费用重置
            if (target.type === "neutral_marker" && target.owner === "neutral") {
                // 找到敌方的仁德将军
                const enemyRole = role === "player1" ? "player2" : "player1";
                const enemyRendeGeneral = Array.from(this.state.units.values()).find(u => u.owner === enemyRole && u.type === "general" && u.generalType === "rende");
                if (enemyRendeGeneral) {
                    enemyRendeGeneral.convertInfantryCost = 1;
                    this.addBattleLog(`击杀中立标记，${enemyRole === "player1" ? "玩家1" : "玩家2"}的转化费用重置为1点`);
                }
            }
            // 首次击杀奖励：立即获得额外骰子和行动点
            if (role === "player1" && !this.state.player1KilledThisTurn) {
                this.state.player1KilledThisTurn = true;
                this.state.player1KillDice++;
                // 立即投掷额外的骰子并增加行动点
                const extraRoll = Math.floor(Math.random() * 6) + 1;
                this.state.player1Dice++;
                this.state.player1DiceResults.push(extraRoll);
                this.state.player1ActionPoints += extraRoll;
                this.addBattleLog(`玩家1首次击杀！获得额外骰子，投出${extraRoll}点`);
            }
            else if (role === "player2" && !this.state.player2KilledThisTurn) {
                this.state.player2KilledThisTurn = true;
                this.state.player2KillDice++;
                // 立即投掷额外的骰子并增加行动点
                const extraRoll = Math.floor(Math.random() * 6) + 1;
                this.state.player2Dice++;
                this.state.player2DiceResults.push(extraRoll);
                this.state.player2ActionPoints += extraRoll;
                this.addBattleLog(`玩家2首次击杀！获得额外骰子，投出${extraRoll}点`);
            }
            // 检查是否击杀了将军（失去基础骰子，下回合生效）
            if (target.type === "general") {
                this.addBattleLog(`${target.owner === "player1" ? "玩家1" : "玩家2"}的将军阵亡！下回合失去基础骰子`);
            }
        }
    }
    /**
     * 处理弩车贯穿攻击
     */
    handleBallistaPierceAttack(client, data) {
        const role = this.getPlayerRole(client);
        if (!role || role !== this.state.currentPlayer) {
            client.send("error", { message: "不是你的回合" });
            return;
        }
        const ballista = this.state.units.get(data.ballistaId);
        if (!ballista || ballista.owner !== role || ballista.type !== "ballista") {
            client.send("error", { message: "无效的弩车单位" });
            return;
        }
        // 检查是否已行动
        if (ballista.hasActedThisTurn) {
            client.send("error", { message: "弩车本回合已行动" });
            return;
        }
        // 检查行动点
        if (role === "player1") {
            if (this.state.player1ActionPoints < 1) {
                client.send("error", { message: "行动点不足" });
                return;
            }
            this.state.player1ActionPoints -= 1;
        }
        else {
            if (this.state.player2ActionPoints < 1) {
                client.send("error", { message: "行动点不足" });
                return;
            }
            this.state.player2ActionPoints -= 1;
        }
        // 计算垂直贯穿路径
        const isPlayerOne = role === "player1";
        const shootingPath = this.getBallistaVerticalPath(ballista, isPlayerOne);
        // 找到路径上的所有单位
        const hitUnits = [];
        const hitUnitsIds = new Set();
        shootingPath.forEach(hexPos => {
            const unit = Array.from(this.state.units.values()).find(u => {
                if (u.id === ballista.id || hitUnitsIds.has(u.id))
                    return false;
                // 检查是否是机关单位
                if (u.type === 'ballista' || u.type === 'chariot') {
                    const machineType = u.type === 'ballista' ? 'ballista' : 'chariot';
                    const occupiedHexes = (0, hexUtils_1.getMachineOccupiedHexes)({ q: u.q, r: u.r, s: u.s }, machineType);
                    return occupiedHexes.some(hex => (0, hexUtils_1.hexEquals)(hex, hexPos));
                }
                // 普通单位只检查中心位置
                return u.q === hexPos.q && u.r === hexPos.r && u.s === hexPos.s;
            });
            if (unit) {
                hitUnits.push(unit);
                hitUnitsIds.add(unit.id);
            }
        });
        if (hitUnits.length === 0) {
            client.send("error", { message: "没有目标" });
            // 退还行动点
            if (role === "player1") {
                this.state.player1ActionPoints += 1;
            }
            else {
                this.state.player2ActionPoints += 1;
            }
            return;
        }
        // 对所有被击中的单位造成伤害
        hitUnits.forEach(target => {
            target.hp -= 1;
            // 骑兵受伤后变步兵
            if (target.type === "cavalry" && target.hp > 0) {
                target.type = "infantry";
                target.maxHp = 2;
                target.hp = 2;
                this.addBattleLog(`${target.owner}的骑兵被贯穿受伤，变成满血步兵！`);
            }
            // 检查是否击杀
            if (target.hp <= 0) {
                // 如果击杀的是战车，先生成2个不可行动的步兵，再删除战车
                if (target.type === 'chariot') {
                    this.handleChariotDeath(target);
                    this.state.units.delete(target.id);
                    this.addBattleLog(`${target.owner}的战车被弩车贯穿击杀，崩毁！`);
                }
                else {
                    // 非战车单位：直接删除
                    this.state.units.delete(target.id);
                    this.addBattleLog(`${target.owner}的${target.type}被弩车贯穿击杀！`);
                }
                // 如果击杀了将军，永久减少对方骰子数
                if (target.type === "general") {
                    if (target.owner === "player1") {
                        this.state.player1Dice = Math.max(0, this.state.player1Dice - 1);
                        this.state.player1LostDice++;
                    }
                    else {
                        this.state.player2Dice = Math.max(0, this.state.player2Dice - 1);
                        this.state.player2LostDice++;
                    }
                    this.addBattleLog(`${target.owner}的将军被击杀，永久失去1颗骰子！`);
                }
                // 首次击杀奖励（只对敌方单位）
                if (target.owner !== role) {
                    if (role === "player1" && !this.state.player1KilledThisTurn) {
                        this.state.player1KilledThisTurn = true;
                        this.state.player1KillDice++;
                        const extraRoll = Math.floor(Math.random() * 6) + 1;
                        this.state.player1Dice++;
                        this.state.player1DiceResults.push(extraRoll);
                        this.state.player1ActionPoints += extraRoll;
                        this.addBattleLog(`玩家1首次击杀！获得额外骰子，投出${extraRoll}点`);
                    }
                    else if (role === "player2" && !this.state.player2KilledThisTurn) {
                        this.state.player2KilledThisTurn = true;
                        this.state.player2KillDice++;
                        const extraRoll = Math.floor(Math.random() * 6) + 1;
                        this.state.player2Dice++;
                        this.state.player2DiceResults.push(extraRoll);
                        this.state.player2ActionPoints += extraRoll;
                        this.addBattleLog(`玩家2首次击杀！获得额外骰子，投出${extraRoll}点`);
                    }
                }
            }
            else {
                this.addBattleLog(`${target.owner}的${target.type}被弩车贯穿，受到1点伤害`);
                target.isFlipped = true;
            }
        });
        // 更新弩车状态：增加贯穿计数
        ballista.pierceCount += hitUnits.length;
        ballista.hasActedThisTurn = true;
        ballista.hasAttacked = true;
        ballista.actionsThisTurn = (ballista.actionsThisTurn || 0) + 1;
        this.addBattleLog(`${role === "player1" ? "玩家1" : "玩家2"}的弩车贯穿攻击，命中${hitUnits.length}个目标（累计贯穿${ballista.pierceCount}个）`);
        client.send("info", { message: "贯穿攻击成功" });
    }
    /**
     * 处理弩车近战攻击
     */
    handleBallistaMeleeAttack(client, data) {
        const role = this.getPlayerRole(client);
        if (!role || role !== this.state.currentPlayer) {
            client.send("error", { message: "不是你的回合" });
            return;
        }
        const ballista = this.state.units.get(data.ballistaId);
        const target = this.state.units.get(data.targetId);
        if (!ballista || !target) {
            client.send("error", { message: "单位不存在" });
            return;
        }
        if (ballista.owner !== role || ballista.type !== "ballista") {
            client.send("error", { message: "无效的弩车单位" });
            return;
        }
        // 检查是否已行动
        if (ballista.hasActedThisTurn) {
            client.send("error", { message: "弩车本回合已行动" });
            return;
        }
        // 检查行动点
        if (role === "player1") {
            if (this.state.player1ActionPoints < 1) {
                client.send("error", { message: "行动点不足" });
                return;
            }
            this.state.player1ActionPoints -= 1;
        }
        else {
            if (this.state.player2ActionPoints < 1) {
                client.send("error", { message: "行动点不足" });
                return;
            }
            this.state.player2ActionPoints -= 1;
        }
        // 弩车近战攻击造成1点伤害
        target.hp -= 1;
        ballista.hasActedThisTurn = true;
        ballista.hasAttacked = true;
        ballista.actionsThisTurn = (ballista.actionsThisTurn || 0) + 1;
        this.addBattleLog(`${role === "player1" ? "玩家1" : "玩家2"}的弩车近战攻击${target.owner}的${target.type}，造成1点伤害`);
        // 骑兵受伤后变步兵
        if (target.type === "cavalry" && target.hp > 0) {
            target.type = "infantry";
            target.maxHp = 2;
            target.hp = 2;
            this.addBattleLog(`${target.owner}的骑兵受伤，变成满血步兵！`);
        }
        // 检查是否击杀
        if (target.hp <= 0) {
            // 如果击杀的是战车，先生成2个不可行动的步兵，再删除战车
            if (target.type === 'chariot') {
                this.handleChariotDeath(target);
                this.state.units.delete(data.targetId);
                this.addBattleLog(`${target.owner}的战车被弩车近战击杀，崩毁！`);
            }
            else {
                // 非战车单位：直接删除
                this.state.units.delete(data.targetId);
                this.addBattleLog(`${target.owner}的${target.type}被弩车近战击杀！`);
            }
            // 如果击杀了将军，永久减少对方骰子数
            if (target.type === "general") {
                if (target.owner === "player1") {
                    this.state.player1Dice = Math.max(0, this.state.player1Dice - 1);
                    this.state.player1LostDice++;
                }
                else {
                    this.state.player2Dice = Math.max(0, this.state.player2Dice - 1);
                    this.state.player2LostDice++;
                }
                this.addBattleLog(`${target.owner}的将军被击杀，永久失去1颗骰子！`);
            }
            // 增加击杀计数（近战也算击杀，但不算贯穿）
            if (target.owner !== role) {
                ballista.killCount++;
            }
            // 首次击杀奖励
            if (target.owner !== role) {
                if (role === "player1" && !this.state.player1KilledThisTurn) {
                    this.state.player1KilledThisTurn = true;
                    this.state.player1KillDice++;
                    const extraRoll = Math.floor(Math.random() * 6) + 1;
                    this.state.player1Dice++;
                    this.state.player1DiceResults.push(extraRoll);
                    this.state.player1ActionPoints += extraRoll;
                    this.addBattleLog(`玩家1首次击杀！获得额外骰子，投出${extraRoll}点`);
                }
                else if (role === "player2" && !this.state.player2KilledThisTurn) {
                    this.state.player2KilledThisTurn = true;
                    this.state.player2KillDice++;
                    const extraRoll = Math.floor(Math.random() * 6) + 1;
                    this.state.player2Dice++;
                    this.state.player2DiceResults.push(extraRoll);
                    this.state.player2ActionPoints += extraRoll;
                    this.addBattleLog(`玩家2首次击杀！获得额外骰子，投出${extraRoll}点`);
                }
            }
        }
        else {
            target.isFlipped = true;
        }
        client.send("info", { message: "近战攻击成功" });
    }
    /**
     * 计算弩车垂直贯穿路径
     */
    getBallistaVerticalPath(ballista, isPlayerOne) {
        const path = [];
        // 正前方推进的增量
        // 玩家1: (q+1, r-2, s+1)
        // 玩家2: (q-1, r+2, s-1)
        const dq = isPlayerOne ? 1 : -1;
        const dr = isPlayerOne ? -2 : 2;
        const ds = isPlayerOne ? 1 : -1;
        let current = { q: ballista.q, r: ballista.r, s: ballista.s };
        while (true) {
            // 计算下一个正前方位置
            const nextQ = current.q + dq;
            const nextR = current.r + dr;
            const nextS = current.s + ds;
            current = { q: nextQ, r: nextR, s: nextS };
            if (!(0, hexUtils_1.isInMapRange)(current, 5)) {
                break;
            }
            path.push(current);
        }
        return path;
    }
    /**
     * 处理旋转单位（弓箭手朝向）
     */
    handleRotateUnit(client, data) {
        const role = this.getPlayerRole(client);
        if (!role || role !== this.state.currentPlayer)
            return;
        const unit = this.state.units.get(data.unitId);
        if (!unit || unit.owner !== role)
            return;
        // 检查弓兵行动次数上限（2次）
        if (unit.type === 'archer' && unit.actionsThisTurn >= 2) {
            client.send("error", { message: "该单位本回合已达行动次数上限" });
            return;
        }
        // 检查是否已转向
        if (unit.hasRotated) {
            client.send("error", { message: "本回合已转向" });
            return;
        }
        // 扣除行动点（转向消耗1点）
        if (role === "player1") {
            if (this.state.player1ActionPoints < 1) {
                client.send("error", { message: "行动点不足" });
                return;
            }
            this.state.player1ActionPoints -= 1;
        }
        else {
            if (this.state.player2ActionPoints < 1) {
                client.send("error", { message: "行动点不足" });
                return;
            }
            this.state.player2ActionPoints -= 1;
        }
        unit.direction = data.direction;
        unit.hasRotated = true; // 标记已转向
        unit.actionsThisTurn = (unit.actionsThisTurn || 0) + 1; // 增加行动次数
        this.addBattleLog(`${role}旋转${unit.type}朝向（消耗1点行动值）`);
    }
    /**
     * 处理结束回合
     */
    handleEndTurn(client) {
        const role = this.getPlayerRole(client);
        if (!role || role !== this.state.currentPlayer) {
            client.send("error", { message: "不是你的回合" });
            return;
        }
        // 特殊处理：部署阶段的结束回合
        if (this.state.phase === "deploy") {
            if (role === "player1") {
                // 玩家1结束部署，轮到玩家2
                this.state.currentPlayer = "player2";
                this.state.player1ActionPoints = 0;
                this.addBattleLog("玩家1完成部署，轮到玩家2");
                // 玩家2在部署阶段需要投骰子（根据玩家1的部署情况）
                // 使用累计的部署价值（已在部署时累加，不会因单位死亡而减少）
                const deployedValue = this.state.player1DeployedValue;
                const diceCount = 1 + Math.floor(deployedValue);
                const results = [];
                for (let i = 0; i < diceCount; i++) {
                    results.push(Math.floor(Math.random() * 6) + 1);
                }
                const totalPoints = results.reduce((sum, val) => sum + val, 0);
                this.state.player2Dice = diceCount;
                this.state.player2DiceResults.clear();
                results.forEach(r => this.state.player2DiceResults.push(r));
                this.state.player2ActionPoints = totalPoints;
                this.addBattleLog(`玩家2投骰子：${diceCount}颗骰子（基础1+玩家1部署${deployedValue.toFixed(1)}元），点数${results.join(',')}，共${totalPoints}点行动值`);
                return;
            }
            else {
                // 玩家2结束部署，进入行动阶段
                this.state.phase = "action";
                this.state.currentPlayer = "player1";
                this.state.player2ActionPoints = 0;
                // 重置所有单位的行动标记（部署阶段的行动不影响行动阶段）
                this.state.units.forEach((unit) => {
                    unit.hasMoved = false;
                    unit.hasAttacked = false;
                    unit.hasRotated = false;
                    unit.actionsThisTurn = 0;
                    if (unit.type === "ballista" || unit.type === "chariot") {
                        unit.hasActedThisTurn = false;
                    }
                });
                this.addBattleLog("部署完成！进入第1回合");
                this.broadcast("phaseChange", { phase: "action" });
                // 自动为玩家1投骰子开始第一回合
                this.rollDiceForPlayer("player1");
                return;
            }
        }
        // 行动阶段：正常的回合结束逻辑
        // 重置本回合标记
        this.state.units.forEach((unit) => {
            if (unit.owner === role) {
                unit.hasMoved = false;
                unit.hasAttacked = false;
                unit.hasRotated = false; // 重置转向标记
                unit.actionsThisTurn = 0;
                // 重置将军的特殊状态
                if (unit.type === "general") {
                    unit.isInvincible = false;
                    unit.unlimitedActions = false;
                    unit.hasFanAttacked = false;
                    unit.bonusActionLimit = 0;
                }
                // 重置机关单位的已行动状态
                if (unit.type === "ballista" || unit.type === "chariot") {
                    unit.hasActedThisTurn = false;
                }
            }
        });
        // 重置击杀标记和击杀骰子（只在当回合有效）
        // 同时保存本回合的击杀状态到"上回合"
        if (role === "player1") {
            this.state.player1KilledLastTurn = this.state.player1KilledThisTurn;
            this.state.player1KilledThisTurn = false;
            this.state.player1KillDice = 0;
            this.state.player1TempMaxActionPoints = -1; // 重置临时行动值上限
        }
        else {
            this.state.player2KilledLastTurn = this.state.player2KilledThisTurn;
            this.state.player2KilledThisTurn = false;
            this.state.player2KillDice = 0;
            this.state.player2TempMaxActionPoints = -1;
        }
        // 重置扇形攻击状态（如果有正在进行的扇形攻击）
        if (this.state.wushuangFanAttackActive && this.state.wushuangAttackingPlayer === role) {
            this.resetWushuangFanAttack();
        }
        // 切换玩家
        if (this.state.currentPlayer === "player1") {
            this.state.currentPlayer = "player2";
            this.addBattleLog("--- 玩家2的回合 ---");
            // 自动为玩家2投骰子
            this.rollDiceForPlayer("player2");
        }
        else {
            this.state.currentPlayer = "player1";
            this.state.turn++;
            this.addBattleLog(`--- 第${this.state.turn}回合 - 玩家1 ---`);
            // 自动为玩家1投骰子
            this.rollDiceForPlayer("player1");
        }
        this.broadcast("turnChange", { currentPlayer: this.state.currentPlayer });
    }
    /**
     * 辅助函数：获取将领中文名
     */
    getGeneralName(type) {
        const names = {
            wushuang: "无双",
            shenji: "神机",
            rende: "仁德"
        };
        return names[type] || type;
    }
    // ========================================
    // 无双将军扇形攻击处理器
    // ========================================
    /**
     * 处理开始扇形攻击
     */
    handleWushuangFanAttackStart(client) {
        const role = this.getPlayerRole(client);
        if (!role || role !== this.state.currentPlayer) {
            client.send("error", { message: "不是你的回合" });
            return;
        }
        // 查找无双将军
        const general = Array.from(this.state.units.values()).find(u => u.owner === role && u.type === "general" && u.generalType === "wushuang");
        if (!general) {
            client.send("error", { message: "你没有无双将军" });
            return;
        }
        // 检查行动点是否足够（需要3点）
        const currentActionPoints = role === "player1"
            ? this.state.player1ActionPoints
            : this.state.player2ActionPoints;
        if (currentActionPoints < 3) {
            client.send("error", { message: "行动点不足（需要3点）" });
            return;
        }
        // 检查行动次数上限
        const bonusActions = general.bonusActionLimit || 0;
        const actionLimit = 2 + bonusActions;
        if (general.actionsThisTurn >= actionLimit) {
            client.send("error", { message: "已达到本回合行动次数上限" });
            return;
        }
        // 检查是否有无限行动标志（无双技能）
        const hasUnlimitedActions = general.unlimitedActions;
        // 如果没有无限行动且没有额外行动次数，检查是否已使用过扇形攻击
        if (!hasUnlimitedActions && bonusActions === 0 && general.hasFanAttacked) {
            client.send("error", { message: "本回合已使用过扇形攻击" });
            return;
        }
        // 启动扇形攻击状态
        this.state.wushuangFanAttackActive = true;
        this.state.wushuangAttackingPlayer = role;
        this.state.wushuangAttackPhase = "select-direction";
        this.state.wushuangSelectedDirection = -1;
        this.state.wushuangDiceRolls.clear();
        this.addBattleLog(`${role === "player1" ? "玩家1" : "玩家2"}发动无双扇形攻击！`);
        client.send("info", { message: "请选择攻击方向" });
    }
    /**
     * 处理选择方向
     */
    handleWushuangSelectDirection(client, data) {
        const role = this.getPlayerRole(client);
        if (!role || role !== this.state.wushuangAttackingPlayer) {
            client.send("error", { message: "不是你的扇形攻击" });
            return;
        }
        if (!this.state.wushuangFanAttackActive) {
            client.send("error", { message: "扇形攻击未激活" });
            return;
        }
        this.state.wushuangSelectedDirection = data.direction;
        this.addBattleLog(`选择了攻击方向：${this.getDirectionName(data.direction)}`);
        client.send("info", { message: "方向已选择，请确认攻击" });
    }
    /**
     * 处理执行攻击
     */
    handleWushuangExecuteAttack(client) {
        const role = this.getPlayerRole(client);
        if (!role || role !== this.state.wushuangAttackingPlayer) {
            client.send("error", { message: "不是你的扇形攻击" });
            return;
        }
        if (!this.state.wushuangFanAttackActive) {
            client.send("error", { message: "扇形攻击未激活" });
            return;
        }
        if (this.state.wushuangSelectedDirection === -1) {
            client.send("error", { message: "请先选择攻击方向" });
            return;
        }
        // 查找无双将军
        const general = Array.from(this.state.units.values()).find(u => u.owner === role && u.type === "general" && u.generalType === "wushuang");
        if (!general) {
            client.send("error", { message: "找不到无双将军" });
            return;
        }
        // 根据攻击阶段执行不同逻辑
        if (this.state.wushuangAttackPhase === "select-direction") {
            // 第一次攻击：消耗3点行动值
            this.performFanAttack(general, role, this.state.wushuangSelectedDirection);
            // 标记已使用扇形攻击 + 增加行动次数
            general.hasFanAttacked = true;
            general.actionsThisTurn = (general.actionsThisTurn || 0) + 1;
            // 消耗3点行动值
            if (role === "player1") {
                this.state.player1ActionPoints -= 3;
            }
            else {
                this.state.player2ActionPoints -= 3;
            }
            // 进入第二阶段
            this.state.wushuangAttackPhase = "second-roll";
            this.state.wushuangSelectedDirection = -1; // 重置方向
            this.addBattleLog("第一次攻击完成，是否消耗2点行动值继续掷骰？");
        }
        else if (this.state.wushuangAttackPhase === "second-attack") {
            // 第二次攻击
            this.performFanAttack(general, role, this.state.wushuangSelectedDirection);
            // 进入第三阶段
            this.state.wushuangAttackPhase = "third-roll";
            this.state.wushuangSelectedDirection = -1;
            this.addBattleLog("第二次攻击完成，进入第三阶段");
        }
        else if (this.state.wushuangAttackPhase === "third-attack") {
            // 第三次攻击
            this.performFanAttack(general, role, this.state.wushuangSelectedDirection);
            // 完成攻击
            this.addBattleLog("无双扇形攻击全部完成！");
            this.resetWushuangFanAttack();
        }
    }
    /**
     * 处理第二阶段掷骰
     */
    handleWushuangSecondRoll(client) {
        const role = this.getPlayerRole(client);
        if (!role || role !== this.state.wushuangAttackingPlayer) {
            client.send("error", { message: "不是你的扇形攻击" });
            return;
        }
        if (this.state.wushuangAttackPhase !== "second-roll") {
            client.send("error", { message: "当前不在第二阶段" });
            return;
        }
        // 检查是否已经掷过骰子（防止重复掷骰）
        if (this.state.wushuangDiceRolls.length > 0) {
            client.send("error", { message: "已经掷过骰子了，请点击'结束'按钮" });
            return;
        }
        // 检查行动值是否足够（需要2点）
        const currentActionPoints = role === "player1"
            ? this.state.player1ActionPoints
            : this.state.player2ActionPoints;
        if (currentActionPoints < 2) {
            this.addBattleLog("行动值不足，扇形攻击结束");
            this.resetWushuangFanAttack();
            return;
        }
        // 消耗2点行动值
        if (role === "player1") {
            this.state.player1ActionPoints -= 2;
        }
        else {
            this.state.player2ActionPoints -= 2;
        }
        // 掷骰子
        const roll = Math.floor(Math.random() * 6) + 1;
        this.state.wushuangDiceRolls.push(roll);
        this.addBattleLog(`第二阶段掷骰结果：${roll}`);
        if (roll <= 2) {
            // 掷出1或2，可以进行第二次攻击
            this.addBattleLog(`掷出${roll}！可以进行第二次攻击，请选择方向`);
            this.state.wushuangAttackPhase = "second-attack";
            this.state.wushuangSelectedDirection = -1; // 重置方向，让玩家重新选择
        }
        else {
            // 掷出3-6，第二次攻击未触发，但保持在 second-roll 阶段让玩家看到结果
            this.addBattleLog(`掷出${roll}，第二次攻击未触发，点击"结束"按钮完成扇形攻击`);
            // 不调用 resetWushuangFanAttack()，让玩家可以看到结果并手动点击"结束"
        }
    }
    /**
     * 处理第三阶段掷骰
     */
    handleWushuangThirdRoll(client) {
        const role = this.getPlayerRole(client);
        if (!role || role !== this.state.wushuangAttackingPlayer) {
            client.send("error", { message: "不是你的扇形攻击" });
            return;
        }
        if (this.state.wushuangAttackPhase !== "third-roll") {
            client.send("error", { message: "当前不在第三阶段" });
            return;
        }
        // 检查是否已经掷过第三次骰子（防止重复掷骰）
        // 第三阶段时 wushuangDiceRolls 应该已经有1个元素（第二阶段的），如果有2个就说明已经掷过了
        if (this.state.wushuangDiceRolls.length > 1) {
            client.send("error", { message: "已经掷过骰子了，请点击'结束'按钮" });
            return;
        }
        // 检查行动值是否足够（需要1点）
        const currentActionPoints = role === "player1"
            ? this.state.player1ActionPoints
            : this.state.player2ActionPoints;
        if (currentActionPoints < 1) {
            this.addBattleLog("行动值不足，扇形攻击结束");
            this.resetWushuangFanAttack();
            return;
        }
        // 消耗1点行动值
        if (role === "player1") {
            this.state.player1ActionPoints -= 1;
        }
        else {
            this.state.player2ActionPoints -= 1;
        }
        // 掷骰子
        const roll = Math.floor(Math.random() * 6) + 1;
        this.state.wushuangDiceRolls.push(roll);
        this.addBattleLog(`第三阶段掷骰结果：${roll}`);
        if (roll === 1) {
            // 掷出1，可以进行第三次攻击
            this.addBattleLog("掷出1！可以进行第三次攻击，请选择方向");
            this.state.wushuangAttackPhase = "third-attack";
            this.state.wushuangSelectedDirection = -1; // 重置方向，让玩家重新选择
        }
        else {
            // 掷出2-6，第三次攻击未触发，但保持在 third-roll 阶段让玩家看到结果
            this.addBattleLog(`掷出${roll}，第三次攻击未触发，点击"结束"按钮完成扇形攻击`);
            // 不调用 resetWushuangFanAttack()，让玩家可以看到结果并手动点击"结束"
        }
    }
    /**
     * 处理取消扇形攻击
     */
    handleWushuangCancel(client) {
        const role = this.getPlayerRole(client);
        if (!role || role !== this.state.wushuangAttackingPlayer) {
            client.send("error", { message: "不是你的扇形攻击" });
            return;
        }
        this.addBattleLog(`${role === "player1" ? "玩家1" : "玩家2"}取消扇形攻击`);
        this.resetWushuangFanAttack();
    }
    /**
     * 执行扇形攻击逻辑
     */
    performFanAttack(general, attacker, direction) {
        // 获取扇形区域（120度，覆盖3个单位）
        const fanHexes = (0, hexUtils_1.getFanShapedHexes)({ q: general.q, r: general.r, s: general.s }, direction, 3, 5);
        // 找到扇形区域内的所有敌方单位
        const enemyUnits = Array.from(this.state.units.values()).filter(u => {
            if (u.owner === attacker)
                return false;
            return fanHexes.some(hex => (0, hexUtils_1.hexEquals)(hex, { q: u.q, r: u.r, s: u.s }));
        });
        if (enemyUnits.length === 0) {
            this.addBattleLog("该方向没有敌方单位");
            return;
        }
        // 对每个敌方单位造成1点伤害
        enemyUnits.forEach(target => {
            const newHp = target.hp - 1;
            if (newHp <= 0) {
                // 击杀单位
                this.state.units.delete(target.id);
                this.addBattleLog(`扇形攻击击杀了${target.type}！`);
                // 记录击杀
                if (attacker === "player1") {
                    if (!this.state.player1KilledThisTurn) {
                        this.state.player1KilledThisTurn = true;
                        this.state.player1KillDice++;
                        const extraRoll = Math.floor(Math.random() * 6) + 1;
                        this.state.player1Dice++;
                        this.state.player1DiceResults.push(extraRoll);
                        this.state.player1ActionPoints += extraRoll;
                        this.addBattleLog(`玩家1首次击杀！获得额外骰子，投出${extraRoll}点`);
                    }
                }
                else {
                    if (!this.state.player2KilledThisTurn) {
                        this.state.player2KilledThisTurn = true;
                        this.state.player2KillDice++;
                        const extraRoll = Math.floor(Math.random() * 6) + 1;
                        this.state.player2Dice++;
                        this.state.player2DiceResults.push(extraRoll);
                        this.state.player2ActionPoints += extraRoll;
                        this.addBattleLog(`玩家2首次击杀！获得额外骰子，投出${extraRoll}点`);
                    }
                }
                // 如果击杀了将军，减少骰子
                if (target.type === "general") {
                    this.addBattleLog(`${target.owner === "player1" ? "玩家1" : "玩家2"}的将军阵亡！下回合失去基础骰子`);
                }
            }
            else {
                // 造成伤害
                target.hp = newHp;
                target.isFlipped = true;
                this.addBattleLog(`扇形攻击命中${target.type}`);
            }
        });
    }
    /**
     * 重置扇形攻击状态
     */
    resetWushuangFanAttack() {
        this.state.wushuangFanAttackActive = false;
        this.state.wushuangAttackingPlayer = "";
        this.state.wushuangAttackPhase = "";
        this.state.wushuangSelectedDirection = -1;
        this.state.wushuangDiceRolls.clear();
    }
    /**
     * 获取方向名称
     */
    getDirectionName(direction) {
        const names = {
            0: "东",
            1: "东北",
            2: "西北",
            3: "西",
            4: "西南",
            5: "东南",
            6: "北",
            7: "南",
        };
        return names[direction] || "未知";
    }
    // ========================================
    // 无双将军一次性技能处理器
    // ========================================
    /**
     * 处理无双一次性技能：获得已损失体力值的行动次数
     */
    handleWushuangAbility(client) {
        const role = this.getPlayerRole(client);
        if (!role || role !== this.state.currentPlayer) {
            client.send("error", { message: "不是你的回合" });
            return;
        }
        // 查找无双将军
        const general = Array.from(this.state.units.values()).find(u => u.owner === role && u.type === "general" && u.generalType === "wushuang");
        if (!general) {
            client.send("error", { message: "你没有无双将军" });
            return;
        }
        if (general.abilityUsed) {
            client.send("error", { message: "一次性技能已使用" });
            return;
        }
        // 计算已损失的体力值
        const lostHp = general.maxHp - general.hp;
        // 设置技能效果
        general.bonusActionLimit = lostHp; // 增加行动次数上限
        general.unlimitedActions = true; // 解除移动和攻击次数限制
        general.abilityUsed = true; // 标记技能已使用
        const newLimit = 2 + lostHp;
        if (lostHp > 0) {
            this.addBattleLog(`${role === "player1" ? "玩家1" : "玩家2"}使用无双技能：行动次数上限 2 → ${newLimit}，已损失${lostHp}点体力`);
            this.addBattleLog("本回合移动和扇形攻击次数限制解除！");
            client.send("info", { message: `技能生效！行动次数上限增加${lostHp}次，移动和攻击次数限制解除` });
        }
        else {
            this.addBattleLog(`${role === "player1" ? "玩家1" : "玩家2"}使用无双技能：当前满血，行动次数上限不变（仍为2次）`);
            this.addBattleLog("本回合移动和扇形攻击次数限制解除！");
            client.send("info", { message: "技能生效！当前满血，行动次数上限不变，但移动和攻击次数限制解除" });
        }
    }
    // ========================================
    // 神机将军技能处理器
    // ========================================
    /**
     * 处理神机将军部署机关单位
     */
    handleShenjiDeployMachine(client, data) {
        const role = this.getPlayerRole(client);
        if (!role || role !== this.state.currentPlayer) {
            client.send("error", { message: "不是你的回合" });
            return;
        }
        // 查找神机将军
        const general = Array.from(this.state.units.values()).find(u => u.owner === role && u.type === "general" && u.generalType === "shenji");
        if (!general) {
            client.send("error", { message: "你没有神机将军" });
            return;
        }
        // 检查行动点是否足够
        // 弩车需要5点，战车需要4点
        const requiredPoints = data.machineType === 'ballista' ? 5 : 4;
        const currentActionPoints = role === "player1"
            ? this.state.player1ActionPoints
            : this.state.player2ActionPoints;
        if (currentActionPoints < requiredPoints) {
            client.send("error", { message: `行动点不足（需要${requiredPoints}点）` });
            return;
        }
        // 检查是否有足够的兵力库存
        // 弩车需要：4步兵 + 1弓箭手
        // 战车需要：6步兵
        const infantryStock = role === 'player1' ? this.state.player1Infantry : this.state.player2Infantry;
        const archerStock = role === 'player1' ? this.state.player1Archer : this.state.player2Archer;
        if (data.machineType === 'ballista') {
            if (infantryStock < 4 || archerStock < 1) {
                client.send("error", { message: "兵力库存不足：部署弩车需要4步兵+1弓箭手" });
                return;
            }
        }
        else if (data.machineType === 'chariot') {
            if (infantryStock < 6) {
                client.send("error", { message: "兵力库存不足：部署战车需要6步兵" });
                return;
            }
        }
        // 检查位置是否在地图范围内且所有占用格子都没有被占用
        const MAP_RADIUS = 5;
        const occupiedHexes = (0, hexUtils_1.getMachineOccupiedHexes)(data.position, data.machineType);
        // 检查所有占用格子是否在地图范围内
        const allInRange = occupiedHexes.every(hex => (0, hexUtils_1.isInMapRange)(hex, MAP_RADIUS));
        if (!allInRange) {
            client.send("error", { message: "机关单位超出地图边界" });
            return;
        }
        // 检查所有占用格子是否都没有被占用（包括其他机关单位占据的格子）
        const hasCollision = occupiedHexes.some(hex => {
            // 检查是否有单位在这个格子
            const hasUnit = Array.from(this.state.units.values()).some(u => u.q === hex.q && u.r === hex.r && u.s === hex.s);
            // 检查是否被其他机关单位占据
            const occupiedByMachine = this.isHexOccupiedByMachine(hex);
            return hasUnit || occupiedByMachine;
        });
        if (hasCollision) {
            client.send("error", { message: "该位置已被占用或与机关单位冲突" });
            return;
        }
        // 验证机关单位只能部署在中间排
        // 玩家1（上方）：r = 4 （部署区是r=3,4,5三排，中间排是4）
        // 玩家2（下方）：r = -4  （部署区是r=-3,-4,-5三排，中间排是-4）
        const middleRow = role === 'player1' ? 4 : -4;
        if (data.position.r !== middleRow) {
            client.send("error", { message: `机关单位只能部署在中间排（r=${middleRow}）` });
            return;
        }
        // 创建机关单位
        const machine = new GameState_1.UnitSchema();
        machine.id = `unit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        machine.type = data.machineType;
        machine.owner = role;
        machine.q = data.position.q;
        machine.r = data.position.r;
        machine.s = data.position.s;
        // 弩车方向指向对方：player1的弩车指向北(6)，player2的弩车指向南(7)
        // 战车方向无意义，设为0
        // 弩车和战车血量都是4
        if (data.machineType === 'ballista') {
            machine.direction = role === 'player1' ? 6 : 7; // NORTH : SOUTH
        }
        else {
            machine.direction = 0;
        }
        machine.hp = 4;
        machine.maxHp = 4;
        machine.killCount = 0;
        machine.pierceCount = 0;
        machine.hasActedThisTurn = false;
        // 添加到地图
        this.state.units.set(machine.id, machine);
        // 增加已消耗库存（永久消耗）
        if (data.machineType === 'ballista') {
            // 弩车：消耗4步兵 + 1弓箭手库存
            if (role === 'player1') {
                this.state.player1ConsumedInfantry += 4;
                this.state.player1ConsumedArcher += 1;
            }
            else {
                this.state.player2ConsumedInfantry += 4;
                this.state.player2ConsumedArcher += 1;
            }
        }
        else if (data.machineType === 'chariot') {
            // 战车：消耗6步兵库存
            if (role === 'player1') {
                this.state.player1ConsumedInfantry += 6;
            }
            else {
                this.state.player2ConsumedInfantry += 6;
            }
        }
        // 消耗行动点
        if (role === "player1") {
            this.state.player1ActionPoints -= requiredPoints;
        }
        else {
            this.state.player2ActionPoints -= requiredPoints;
        }
        const machineName = data.machineType === 'ballista' ? '弩车' : '战车';
        const troopInfo = data.machineType === 'ballista' ? '4步兵+1弓箭手' : '6步兵';
        this.addBattleLog(`${role === "player1" ? "玩家1" : "玩家2"}消耗${troopInfo}库存和${requiredPoints}点行动值部署了${machineName}`);
        client.send("info", { message: `${machineName}部署成功（消耗${troopInfo}库存和${requiredPoints}点行动值）` });
        // 累加部署价值
        const machineValue = this.getUnitValue(data.machineType);
        if (role === "player1") {
            this.state.player1DeployedValue += machineValue;
        }
        else {
            this.state.player2DeployedValue += machineValue;
        }
    }
    /**
     * 处理神机将军改骰技能
     */
    handleShenjiModifyDice(client, data) {
        const role = this.getPlayerRole(client);
        if (!role || role !== this.state.currentPlayer) {
            client.send("error", { message: "不是你的回合" });
            return;
        }
        // 查找神机将军
        const general = Array.from(this.state.units.values()).find(u => u.owner === role && u.type === "general" && u.generalType === "shenji");
        if (!general) {
            client.send("error", { message: "你没有神机将军" });
            return;
        }
        // 验证新点数范围
        if (data.newValue < 1 || data.newValue > 6) {
            client.send("error", { message: "骰子点数必须在1-6之间" });
            return;
        }
        // 验证骰子索引
        const diceResults = role === "player1" ? this.state.player1DiceResults : this.state.player2DiceResults;
        if (data.diceIndex < 0 || data.diceIndex >= diceResults.length) {
            client.send("error", { message: "无效的骰子索引" });
            return;
        }
        // 修改骰子点数
        const oldValue = diceResults[data.diceIndex];
        diceResults[data.diceIndex] = data.newValue;
        // 计算点数差值，只增加/减少差值（而不是重新计算总和）
        const pointDifference = data.newValue - oldValue;
        if (role === "player1") {
            this.state.player1ActionPoints += pointDifference;
        }
        else {
            this.state.player2ActionPoints += pointDifference;
        }
        this.addBattleLog(`${role === "player1" ? "玩家1" : "玩家2"}使用神机技能：修改骰子 ${oldValue} → ${data.newValue}`);
        client.send("info", { message: `骰子已修改为${data.newValue}` });
    }
    // ========================================
    // 仁德将军技能处理器
    // ========================================
    /**
     * 处理仁德将军转化接触单位技能
     */
    handleRendeConvertAdjacent(client) {
        const role = this.getPlayerRole(client);
        if (!role || role !== this.state.currentPlayer) {
            client.send("error", { message: "不是你的回合" });
            return;
        }
        // 查找仁德将军
        const general = Array.from(this.state.units.values()).find(u => u.owner === role && u.type === "general" && u.generalType === "rende");
        if (!general) {
            client.send("error", { message: "你没有仁德将军" });
            return;
        }
        if (general.abilityUsed) {
            client.send("error", { message: "一次性技能已使用" });
            return;
        }
        // 获取相邻的所有敌方单位
        const generalPos = { q: general.q, r: general.r, s: general.s };
        const neighbors = (0, hexUtils_1.hexRange)(generalPos, 1).filter(hex => !(0, hexUtils_1.hexEquals)(hex, generalPos));
        // 找到所有相邻的敌方单位
        const adjacentEnemies = Array.from(this.state.units.values()).filter(u => {
            if (u.owner === role || u.id === general.id)
                return false;
            // 检查是否是机关单位
            if (u.type === 'ballista' || u.type === 'chariot') {
                const machineType = u.type === 'ballista' ? 'ballista' : 'chariot';
                const occupiedHexes = (0, hexUtils_1.getMachineOccupiedHexes)({ q: u.q, r: u.r, s: u.s }, machineType);
                return occupiedHexes.some(hex => neighbors.some(neighbor => (0, hexUtils_1.hexEquals)(neighbor, hex)));
            }
            // 普通单位
            return neighbors.some(hex => (0, hexUtils_1.hexEquals)(hex, { q: u.q, r: u.r, s: u.s }));
        });
        if (adjacentEnemies.length === 0) {
            client.send("error", { message: "周围没有敌方单位" });
            return;
        }
        // 检查是否有敌方将军
        const enemyGeneral = adjacentEnemies.find(u => u.type === "general");
        if (enemyGeneral) {
            // 检查是否满足"上回合无击杀"的条件
            const killedLastTurn = role === "player1" ? this.state.player1KilledLastTurn : this.state.player2KilledLastTurn;
            if (killedLastTurn) {
                client.send("error", { message: "仁德将军上回合有击杀，无法对敌方将军使用招降技能" });
                return;
            }
            // 满足条件，对敌方将军使用，直接获胜
            this.state.phase = "end";
            this.addBattleLog(`${role === "player1" ? "玩家1" : "玩家2"}仁德将军对敌将使用招降技能，直接获胜！`);
            this.broadcast("gameEnd", {
                winner: role,
                message: `${role === "player1" ? "玩家1" : "玩家2"}获胜！`,
            });
            return;
        }
        // 转化所有相邻的敌方单位为己方单位（改变阵营）
        let convertedCount = 0;
        adjacentEnemies.forEach(enemy => {
            // 直接改变单位的所有者为仁德所属阵营
            enemy.owner = role;
            // 如果是弩车，需要翻转方向（player1的弩车指向北，player2的弩车指向南）
            if (enemy.type === 'ballista') {
                enemy.direction = role === 'player1' ? 6 : 7; // NORTH : SOUTH
            }
            convertedCount++;
        });
        // 标记技能已使用
        general.abilityUsed = true;
        console.log(`[DEBUG] 仁德转化完成 - currentPlayer: ${this.state.currentPlayer}, role: ${role}, convertedCount: ${convertedCount}`);
        this.addBattleLog(`${role === "player1" ? "玩家1" : "玩家2"}使用仁德技能：转化了${convertedCount}个敌方单位为己方单位`);
        client.send("info", { message: `已转化${convertedCount}个单位为己方单位` });
    }
    /**
     * 处理仁德将军转化中立标记为步兵
     */
    handleRendeConvertToInfantry(client, data) {
        const role = this.getPlayerRole(client);
        if (!role || role !== this.state.currentPlayer) {
            client.send("error", { message: "不是你的回合" });
            return;
        }
        // 查找仁德将军
        const general = Array.from(this.state.units.values()).find(u => u.owner === role && u.type === "general" && u.generalType === "rende");
        if (!general) {
            client.send("error", { message: "你没有仁德将军" });
            return;
        }
        if (!general.canConvertNeutral) {
            client.send("error", { message: "无法转化中立单位" });
            return;
        }
        // 查找目标中立标记
        const target = this.state.units.get(data.targetId);
        if (!target || target.type !== "neutral_marker" || target.owner !== "neutral") {
            client.send("error", { message: "目标不是中立标记" });
            return;
        }
        // 计算转化费用（指数增长：1, 2, 4, 8...）
        const currentCost = general.convertInfantryCost || 1;
        // 检查行动点是否足够
        const currentActionPoints = role === "player1"
            ? this.state.player1ActionPoints
            : this.state.player2ActionPoints;
        if (currentActionPoints < currentCost) {
            client.send("error", { message: `行动点不足（需要${currentCost}点）` });
            return;
        }
        // 消耗行动点
        if (role === "player1") {
            this.state.player1ActionPoints -= currentCost;
        }
        else {
            this.state.player2ActionPoints -= currentCost;
        }
        // 创建步兵（血量为1）
        const infantry = new GameState_1.UnitSchema();
        infantry.id = `unit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        infantry.type = "infantry";
        infantry.owner = role;
        infantry.q = target.q;
        infantry.r = target.r;
        infantry.s = target.s;
        infantry.direction = 0;
        infantry.hp = 1;
        infantry.maxHp = 2;
        // 删除中立标记，添加步兵
        this.state.units.delete(target.id);
        this.state.units.set(infantry.id, infantry);
        // 更新转化费用（指数增长）
        general.convertInfantryCost = currentCost * 2;
        this.addBattleLog(`${role === "player1" ? "玩家1" : "玩家2"}转化中立标记为步兵（消耗${currentCost}点，下次需要${currentCost * 2}点）`);
        client.send("info", { message: `已转化为步兵（消耗${currentCost}点）` });
    }
    /**
     * 处理仁德将军击杀确认：直接击杀
     */
    handleRendeCompleteKill(client, data) {
        const role = this.getPlayerRole(client);
        if (!role || role !== this.state.currentPlayer) {
            client.send("error", { message: "不是你的回合" });
            return;
        }
        // 查找目标单位
        const target = this.state.units.get(data.targetId);
        if (!target) {
            client.send("error", { message: "目标单位不存在" });
            return;
        }
        // 如果击杀了战车，先处理战车崩毁（生成步兵），再删除战车
        if (target.type === "chariot") {
            this.handleChariotDeath(target);
        }
        // 删除单位
        this.state.units.delete(data.targetId);
        this.addBattleLog(`${role === "player1" ? "玩家1" : "玩家2"}击杀了${target.owner}的${target.type}`);
        // 首次击杀奖励
        if (role === "player1" && !this.state.player1KilledThisTurn) {
            this.state.player1KilledThisTurn = true;
            this.state.player1KillDice++;
            const extraRoll = Math.floor(Math.random() * 6) + 1;
            this.state.player1Dice++;
            this.state.player1DiceResults.push(extraRoll);
            this.state.player1ActionPoints += extraRoll;
            this.addBattleLog(`玩家1首次击杀！获得额外骰子，投出${extraRoll}点`);
        }
        else if (role === "player2" && !this.state.player2KilledThisTurn) {
            this.state.player2KilledThisTurn = true;
            this.state.player2KillDice++;
            const extraRoll = Math.floor(Math.random() * 6) + 1;
            this.state.player2Dice++;
            this.state.player2DiceResults.push(extraRoll);
            this.state.player2ActionPoints += extraRoll;
            this.addBattleLog(`玩家2首次击杀！获得额外骰子，投出${extraRoll}点`);
        }
        // 如果击杀了将军
        if (target.type === "general") {
            this.addBattleLog(`${target.owner === "player1" ? "玩家1" : "玩家2"}的将军阵亡！下回合失去基础骰子`);
        }
        // 如果击杀了中立标记，重置转化费用
        if (target.type === "neutral_marker" && target.owner === "neutral") {
            const rendeGeneral = Array.from(this.state.units.values()).find(u => u.owner === role && u.type === "general" && u.generalType === "rende");
            if (rendeGeneral) {
                rendeGeneral.convertInfantryCost = 1;
                this.addBattleLog(`击杀中立标记，转化费用重置为1点`);
            }
        }
        // 如果击杀了弩车，检查是否贯穿过2个以上目标，如果是则给神机将军拥有者重投机会
        if (target.type === "ballista") {
            const targetOwner = target.owner;
            const shenjiGeneral = Array.from(this.state.units.values()).find(u => u.owner === targetOwner && u.type === "general" && u.generalType === "shenji");
            // 只有当弩车生前贯穿过2个以上目标时，才给重投机会
            if (shenjiGeneral && target.pierceCount >= 2) {
                if (targetOwner === "player1") {
                    this.state.player1RerollTokens++;
                    this.addBattleLog(`玩家1的弩车被击毁（生前贯穿${target.pierceCount}个目标），获得1次重投机会`);
                }
                else {
                    this.state.player2RerollTokens++;
                    this.addBattleLog(`玩家2的弩车被击毁（生前贯穿${target.pierceCount}个目标），获得1次重投机会`);
                }
            }
            else if (shenjiGeneral) {
                this.addBattleLog(`${targetOwner === "player1" ? "玩家1" : "玩家2"}的弩车被击毁（仅贯穿${target.pierceCount}个目标，未达到2个），无重投奖励`);
            }
        }
        // 注意：战车的处理已经在前面完成，这里不需要再处理
        client.send("info", { message: "击杀完成" });
    }
    /**
     * 处理仁德将军击杀确认：转为中立标记
     */
    handleRendeSpareAsNeutral(client, data) {
        const role = this.getPlayerRole(client);
        if (!role || role !== this.state.currentPlayer) {
            client.send("error", { message: "不是你的回合" });
            return;
        }
        // 查找目标单位
        const target = this.state.units.get(data.targetId);
        if (!target) {
            client.send("error", { message: "目标单位不存在" });
            return;
        }
        // 计算需要消耗的行动点：机关单位根据占用格子数，普通单位1点
        let requiredActionPoints = 1;
        if (target.type === 'ballista' || target.type === 'chariot') {
            const machineType = target.type === 'ballista' ? 'ballista' : 'chariot';
            const occupiedHexes = (0, hexUtils_1.getMachineOccupiedHexes)({ q: target.q, r: target.r, s: target.s }, machineType);
            requiredActionPoints = occupiedHexes.length;
        }
        // 检查行动点是否足够
        const currentActionPoints = role === "player1"
            ? this.state.player1ActionPoints
            : this.state.player2ActionPoints;
        if (currentActionPoints < requiredActionPoints) {
            client.send("error", { message: `行动点不足（需要${requiredActionPoints}点）` });
            return;
        }
        // 消耗行动点
        if (role === "player1") {
            this.state.player1ActionPoints -= requiredActionPoints;
        }
        else {
            this.state.player2ActionPoints -= requiredActionPoints;
        }
        // 检查是否是机关单位
        if (target.type === 'ballista' || target.type === 'chariot') {
            // 机关单位：在所有占用的格子上分别创建中立标记
            const machineType = target.type === 'ballista' ? 'ballista' : 'chariot';
            const occupiedHexes = (0, hexUtils_1.getMachineOccupiedHexes)({ q: target.q, r: target.r, s: target.s }, machineType);
            occupiedHexes.forEach((hex, index) => {
                const neutral = new GameState_1.UnitSchema();
                neutral.id = `unit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${index}`;
                neutral.type = "neutral_marker";
                neutral.owner = "neutral";
                neutral.q = hex.q;
                neutral.r = hex.r;
                neutral.s = hex.s;
                neutral.direction = 0;
                neutral.hp = 1;
                neutral.maxHp = 1;
                this.state.units.set(neutral.id, neutral);
            });
            // 删除机关单位
            this.state.units.delete(target.id);
            this.addBattleLog(`${role === "player1" ? "玩家1" : "玩家2"}将${target.type}转为${occupiedHexes.length}个中立标记（消耗${requiredActionPoints}点）`);
            client.send("info", { message: `已转为${occupiedHexes.length}个中立标记（消耗${requiredActionPoints}点）` });
        }
        else {
            // 普通单位：创建单个中立标记
            const neutral = new GameState_1.UnitSchema();
            neutral.id = `unit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            neutral.type = "neutral_marker";
            neutral.owner = "neutral";
            neutral.q = target.q;
            neutral.r = target.r;
            neutral.s = target.s;
            neutral.direction = 0;
            neutral.hp = 1;
            neutral.maxHp = 1;
            // 删除原单位，添加中立标记
            this.state.units.delete(target.id);
            this.state.units.set(neutral.id, neutral);
            this.addBattleLog(`${role === "player1" ? "玩家1" : "玩家2"}将${target.type}转为中立标记（消耗1点）`);
            client.send("info", { message: "已转为中立标记" });
        }
    }
    /**
     * 处理认输
     */
    handleSurrender(client) {
        const role = this.getPlayerRole(client);
        if (!role) {
            client.send("error", { message: "你不是玩家" });
            return;
        }
        // 宣布对手获胜
        const winner = role === "player1" ? "player2" : "player1";
        this.addBattleLog(`${role === "player1" ? "玩家1" : "玩家2"}认输，${winner === "player1" ? "玩家1" : "玩家2"}获胜！`);
        // 广播游戏结束
        this.broadcast("gameEnd", {
            winner,
            reason: "surrender",
            message: `${role === "player1" ? "玩家1" : "玩家2"}认输，${winner === "player1" ? "玩家1" : "玩家2"}获胜！`
        });
        // 设置游戏阶段为结束
        this.state.phase = "end";
    }
}
exports.ShiyuanRoom = ShiyuanRoom;
