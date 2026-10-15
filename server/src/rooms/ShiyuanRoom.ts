import { Room, Client } from '@colyseus/core';
import { GameStateSchema, UnitSchema, TaipingSchema } from '../schema/GameState';

// 导入共享的六边形工具函数和类型
import {
  hexEquals,
  hexDistance,
  getFanShapedHexes,
  getMachineOccupiedHexes,
  hexRange,
  hexNeighbor,
  hexNeighbors,
  isInMapRange,
  isInStartZone,
  getAxisLineFromTarget,
  knockbackInfantryChain,
  getCatapultSplashTargets,
  getDistanceToBaseline,
  getShootingPath,
  hexLineDraw,
} from '../../../shared/utils/hexUtils';
import { HexCoord } from '../../../shared/types';
import { captureState, restoreState, StateSnapshot } from '../dev/stateSnapshot';
import * as Rules from '../../../shared/rules/queries';

/**
 * 开发工具开关。默认关闭；设 SHIYUAN_DEV_TOOLS=1 才启用存档/读档消息。
 * 打开后任何客户端都能改写对局状态，绝不能在正式服开启。
 */
const DEV_TOOLS = process.env.SHIYUAN_DEV_TOOLS === '1';

/**
 * 十元（Shiyuan）游戏房间
 * 处理2名玩家的回合制对战 + 无限观战者
 */
export class ShiyuanRoom extends Room<GameStateSchema> {
  maxClients = 100;  // 2名玩家 + 最多98名观战者

  // 玩家角色映射
  private playerRoles = new Map<string, 'player1' | 'player2' | 'spectator'>();
  private spectators = new Set<string>();  // 观战者集合

  // 断线追踪：存储已断线但尚在重连窗口内的 sessionId
  private disconnectedSessions = new Set<string>();
  // 已被接管：存储已被新玩家接管的原 sessionId（用于 onReconnection 中转为观战者）
  private takenOverSessions = new Set<string>();

  /** 上次下发合法动作时的状态指纹，用于避免每个 patch tick 都重算 */
  private lastValidActionsFingerprint = '';

  /**
   * 规则查询层要的单位快照。
   *
   * UnitSchema 的字段是 UnitLike 的超集，所以可以直接当数组传过去，
   * 不需要逐字段映射。
   */
  private get unitList(): Rules.UnitLike[] {
    return Array.from(this.state.units.values()) as unknown as Rules.UnitLike[];
  }

  /**
   * 同机轮流（hotseat）模式：一个客户端控制双方，用于「单机对弈」。
   *
   * 这样做是为了让全项目只有一份规则实现 —— 以前单机模式在客户端另有一套
   * 2000 行的规则引擎，和服务端这份会漂移。
   */
  private isHotseat = false;

  /* ══════════════════ 随机数与单位 id ══════════════════
   *
   * 这两样原来都是直接写死的（`Math.random()` 20 处、
   * `unit_${Date.now()}_${Math.random()...}` 9 处），后果是**规则没法测**：
   * 掷骰分支（无双「≤2 才能再攻击」、太平夺天命）靠运气才跑得到，
   * 而单位 id 每次都不一样，测试没法指代「那个被贯穿的弩车」。
   *
   * 所以留两个接缝。生产代码行为不变，测试里替掉即可：
   *   (room as any).rng = seq([3, 5, 1])
   */

  /** 随机源。测试里替换成确定序列 */
  private rng: () => number = Math.random;

  /** 掷一颗六面骰。全项目唯一的 d6 入口 */
  private rollD6(): number {
    return Math.floor(this.rng() * 6) + 1;
  }

  /** 单位 id 计数器。见 newUnitId */
  private nextUnitId = 1;

  /**
   * 生成单位 id：`infantry3` / `ballista1` / `civ7` …
   *
   * 带类型前缀而不是纯序号，是为了让战报和测试断言能读
   * —— `lishi2 转化为 civ9` 比 `u14 转化为 u15` 有用得多。
   * 全局单调递增，所以同一个 id 不会在一局里出现两次，
   * 即使单位已被删除也不复用。
   */
  private newUnitId(kind: string): string {
    return `${kind}${this.nextUnitId++}`;
  }

  /**
   * 把 id 计数器推到当前场上所有 id 之后。
   * 载入开发快照后必须调用 —— 快照里的 id 来自上一局的计数器。
   */
  private syncUnitIdCounter(): void {
    let max = 0;
    this.state.units.forEach((_, id) => {
      const m = /(\d+)$/.exec(id);
      if (m) max = Math.max(max, Number(m[1]));
    });
    this.nextUnitId = Math.max(this.nextUnitId, max + 1);
  }

  /** 统计当前活跃玩家数（排除断线中和已被接管的） */
  private getActivePlayerCount(): number {
    return Array.from(this.playerRoles.entries()).filter(
      ([sid, role]) =>
        role !== 'spectator' &&
        !this.disconnectedSessions.has(sid) &&
        !this.takenOverSessions.has(sid)
    ).length;
  }

  /** 找第一个可接管的断线槽位 */
  private getFirstDisconnectedSlot(): { sessionId: string; role: 'player1' | 'player2' } | null {
    for (const [sid, role] of this.playerRoles.entries()) {
      if (
        this.disconnectedSessions.has(sid) &&
        !this.takenOverSessions.has(sid) &&
        (role === 'player1' || role === 'player2')
      ) {
        return { sessionId: sid, role };
      }
    }
    return null;
  }

  onCreate(options: any) {
    this.setState(new GameStateSchema());

    this.isHotseat = options?.hotseat === true;
    if (this.isHotseat) {
      // 同机轮流只需要一个客户端，不接第二人也不接观战
      this.maxClients = 1;
      console.log("🎮 十元房间创建成功（同机轮流）！Room ID:", this.roomId);
    } else {
      console.log("🎮 十元游戏房间创建成功！Room ID:", this.roomId);
    }

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

  onJoin(client: Client, options: any) {
    // 同机轮流：唯一的客户端同时代表双方，不等第二人，直接开局
    if (this.isHotseat) {
      this.playerRoles.set(client.sessionId, 'player1'); // 占位；实际角色由 getPlayerRole 动态返回
      client.send("role", {
        role: this.state.currentPlayer,
        message: "同机轮流：你操作双方",
        hotseat: true,
      });
      this.broadcast("gameStart", { message: "同机轮流开始！请为玩家一选择将领" });
      this.setMetadata({
        gameName: "十元（同机轮流）",
        players: 1,
        maxPlayers: 1,
        status: "playing",
        spectators: 0,
      });
      console.log(`🪑 同机轮流入座: ${client.sessionId}`);
      return;
    }

    const isSpectator = options.spectator === true;

    // 优先检查是否有断线槽位可以接管（非观战者才可接管）
    if (!isSpectator) {
      const disconnectedSlot = this.getFirstDisconnectedSlot();
      if (disconnectedSlot) {
        const { sessionId: oldSessionId, role: disconnectedRole } = disconnectedSlot;

        // 标记原 session 为已被接管
        this.takenOverSessions.add(oldSessionId);
        this.disconnectedSessions.delete(oldSessionId);

        // 新玩家接管该角色
        this.playerRoles.set(client.sessionId, disconnectedRole);

        const actionPoints = disconnectedRole === 'player1'
          ? this.state.player1ActionPoints
          : this.state.player2ActionPoints;

        client.send("role", {
          role: disconnectedRole,
          message: `你已接管 ${disconnectedRole} 的位置，游戏继续`,
          takenOver: true,
          gamePhase: this.state.phase,
          actionPoints,
          currentPlayer: this.state.currentPlayer,
        });

        this.broadcast("playerTookOver", {
          role: disconnectedRole,
          message: `新玩家接管了 ${disconnectedRole} 的位置`
        }, { except: client });

        console.log(`🔄 新玩家 ${client.sessionId} 接管了 ${disconnectedRole}（原 ${oldSessionId}）`);
        return;
      }
    }

    // 没有断线槽位，按活跃玩家数正常分配
    const activePlayerCount = this.getActivePlayerCount();

    if (isSpectator || activePlayerCount >= 2) {
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

    } else if (activePlayerCount === 0) {
      // 第一个玩家
      this.playerRoles.set(client.sessionId, 'player1');
      client.send("role", { role: "player1", message: "你是玩家1" });
      console.log(`👤 玩家1加入: ${client.sessionId}`);

    } else if (activePlayerCount === 1) {
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

  async onLeave(client: Client, consented: boolean) {
    const role = this.playerRoles.get(client.sessionId);
    console.log(`👋 ${role} 离开房间 (consented: ${consented})`);

    // 非主动断线的玩家（非观战者）：允许60秒内重连
    if (!consented && (role === 'player1' || role === 'player2')) {
      console.log(`⏳ ${role} 断线，等待60秒重连...`);

      // 标记为断线状态（保留 playerRoles 记录供 onReconnection 使用）
      this.disconnectedSessions.add(client.sessionId);

      // 通知另一位玩家
      this.broadcast("playerDisconnected", {
        role,
        message: `${role} 断线了，等待重连（60秒内）`
      });

      try {
        // 必须 await，否则重连 token 不会被正确挂起
        await this.allowReconnection(client, 60);
        // 执行到这里说明原玩家已重连（onReconnection 已处理角色恢复）
        this.disconnectedSessions.delete(client.sessionId);
        this.takenOverSessions.delete(client.sessionId);
      } catch {
        // 60秒超时，清理残留记录
        console.log(`⌛ ${role} 重连超时，释放槽位`);
        this.playerRoles.delete(client.sessionId);
        this.disconnectedSessions.delete(client.sessionId);
        this.takenOverSessions.delete(client.sessionId);

        this.broadcast("playerSlotOpen", {
          role,
          message: `${role} 的位置已空出，等待新玩家加入`
        });
      }
      return;
    }

    // 主动离开，或观战者断线
    this.playerRoles.delete(client.sessionId);
    this.disconnectedSessions.delete(client.sessionId);
    this.takenOverSessions.delete(client.sessionId);

    if (role === 'spectator') {
      this.spectators.delete(client.sessionId);
      console.log(`👁️  观战者离开 (剩余: ${this.spectators.size})`);
      return;
    }

    // 游戏进行中主动离开，通知另一方
    if (this.state.phase !== "general_select" && this.state.phase !== "end") {
      this.broadcast("playerLeft", {
        role,
        message: `${role} 离开了游戏`
      });
    }
  }

  async onReconnection(client: Client, previousSessionId: string) {
    console.log(`🔄 玩家重连: ${client.sessionId} (之前的 sessionId: ${previousSessionId})`);

    const role = this.playerRoles.get(previousSessionId);

    // 如果该槽位已被新玩家接管，降级为观战者
    if (this.takenOverSessions.has(previousSessionId)) {
      this.playerRoles.delete(previousSessionId);
      this.takenOverSessions.delete(previousSessionId);
      this.disconnectedSessions.delete(previousSessionId);

      this.playerRoles.set(client.sessionId, 'spectator');
      this.spectators.add(client.sessionId);

      client.send("role", {
        role: 'spectator',
        message: `你的位置已被新玩家接管，现在以观战者身份加入`
      });
      console.log(`ℹ️  ${role} 的槽位已被接管，${client.sessionId} 降级为观战者`);
      return;
    }

    if (role) {
      // 正常重连：更新 sessionId，角色不变
      this.playerRoles.delete(previousSessionId);
      this.playerRoles.set(client.sessionId, role);
      this.disconnectedSessions.delete(previousSessionId);

      if (role === 'spectator') {
        this.spectators.delete(previousSessionId);
        this.spectators.add(client.sessionId);
      }

      const actionPoints = role === 'player1'
        ? this.state.player1ActionPoints
        : role === 'player2'
          ? this.state.player2ActionPoints
          : 0;

      client.send("role", {
        role,
        message: `重连成功！你是 ${role === 'spectator' ? '观战者' : role}`,
        reconnected: true,
        gamePhase: this.state.phase,
        actionPoints,
        currentPlayer: this.state.currentPlayer,
      });

      console.log(`✅ ${role} 重连成功: ${previousSessionId} → ${client.sessionId}`);

      this.broadcast("playerReconnected", {
        role,
        message: `${role} 重新连接了`
      }, { except: client });
    } else {
      console.log(`❌ 未找到重连角色信息`);
    }
  }

  onDispose() {
    console.log("🗑️  房间被销毁:", this.roomId);
  }

  /**
   * 强制阶段（豆饭征募，以及步骤 11 的腐化）里仍然允许发的指令。
   *
   * 其余一律被 rejectIfForcedPhasePending 拦住 —— 这是
   * 「玩家不能主动拒绝征募」那条规则的实现方式。
   */
  private static readonly FORCED_PHASE_EXEMPT: ReadonlySet<string> = new Set([
    'taipingRecruit',   // 正是此刻要你做的事
    'taipingCorrupt',   // 同上
    'surrender',        // 任何时候都能认输
    '__devSaveState',
    '__devLoadState',
  ]);

  /**
   * 注册一条玩家指令，并统一套上强制阶段的拦截。
   *
   * 走一个中间层而不是在 31 个 handler 里各加一句，是因为漏掉任何一个
   * 都会留出一条绕过强制征募的后门 —— 而且那种后门只在特定兵种、
   * 特定技能下才暴露出来。
   */
  private onAction(type: string, handler: (client: Client, data: any) => void) {
    this.onMessage(type, (client: Client, data: any) => {
      if (!ShiyuanRoom.FORCED_PHASE_EXEMPT.has(type) && this.rejectIfForcedPhasePending(client)) {
        return;
      }
      handler(client, data);
    });
  }

  /**
   * 注册所有消息处理器
   */
  private registerMessageHandlers() {
    // === 前置阶段 ===
    this.onAction("selectGeneral", (client, data) => {
      this.handleSelectGeneral(client, data);
    });

    this.onAction("buildArmy", (client, data) => {
      this.handleBuildArmy(client, data);
    });

    this.onAction("setupBase", (client, data) => {
      this.handleSetupBase(client, data);
    });

    // === 部署阶段 ===
    this.onAction("deployUnit", (client, data) => {
      this.handleDeployUnit(client, data);
    });

    this.onAction("finishDeploy", (client, data) => {
      this.handleFinishDeploy(client);
    });

    // === 行动阶段 ===
    this.onAction("rollDice", (client, data) => {
      this.handleRollDice(client);
    });

    this.onAction("rerollDice", (client, data) => {
      this.handleRerollDice(client, data);
    });

    this.onAction("moveUnit", (client, data) => {
      this.handleMoveUnit(client, data);
    });

    this.onAction("attackUnit", (client, data) => {
      this.handleAttackUnit(client, data);
    });

    this.onAction("rotateUnit", (client, data) => {
      this.handleRotateUnit(client, data);
    });

    this.onAction("endTurn", (client, data) => {
      this.handleEndTurn(client);
    });

    // === 无双将军扇形攻击 ===
    this.onAction("wushuangFanAttackStart", (client, data) => {
      this.handleWushuangFanAttackStart(client);
    });

    this.onAction("wushuangSelectDirection", (client, data) => {
      this.handleWushuangSelectDirection(client, data);
    });

    this.onAction("wushuangExecuteAttack", (client, data) => {
      this.handleWushuangExecuteAttack(client);
    });

    this.onAction("wushuangSecondRoll", (client, data) => {
      this.handleWushuangSecondRoll(client);
    });

    this.onAction("wushuangThirdRoll", (client, data) => {
      this.handleWushuangThirdRoll(client);
    });

    this.onAction("wushuangCancel", (client, data) => {
      this.handleWushuangCancel(client);
    });

    // === 无双将军一次性技能 ===
    this.onAction("wushuangAbility", (client, data) => {
      this.handleWushuangAbility(client);
    });

    // === 神机将军技能 ===
    this.onAction("shenjiDeployMachine", (client, data) => {
      this.handleShenjiDeployMachine(client, data);
    });

    this.onAction("shenjiModifyDice", (client, data) => {
      this.handleShenjiModifyDice(client, data);
    });

    // === 投石车蓄力 ===
    this.onAction("catapultCharge", (client, data) => {
      this.handleCatapultCharge(client, data);
    });

    // === 弩车攻击 ===
    this.onAction("ballistaPierceAttack", (client, data) => {
      this.handleBallistaPierceAttack(client, data);
    });

    this.onAction("ballistaMeleeAttack", (client, data) => {
      this.handleBallistaMeleeAttack(client, data);
    });

    // === 仁德将军技能 ===
    this.onAction("rendeConvertAdjacent", (client, data) => {
      this.handleRendeConvertAdjacent(client);
    });

    this.onAction("rendeConvertToInfantry", (client, data) => {
      this.handleRendeConvertToInfantry(client, data);
    });

    this.onAction("rendeCompleteKill", (client, data) => {
      this.handleRendeCompleteKill(client, data);
    });

    this.onAction("rendeSpareAsNeutral", (client, data) => {
      this.handleRendeSpareAsNeutral(client, data);
    });

    this.onAction("surrender", (client) => {
      this.handleSurrender(client);
    });

    // === 太平将军技能 ===
    this.onAction("taipingFushui", (client, data: { civilianId: string }) => {
      this.handleTaipingFushui(client, data);
    });

    this.onAction("taipingRecruit", (client, data: { civilianId: string }) => {
      this.handleTaipingRecruit(client, data);
    });

    this.onAction("taipingDeclareHuangtian", (client) => {
      this.handleTaipingDeclareHuangtian(client);
    });

    this.onAction("taipingCorrupt", (client, data: { zeiId: string; civilianId: string }) => {
      this.handleTaipingCorrupt(client, data);
    });

    // === 开发工具：存档 / 读档（仅 SHIYUAN_DEV_TOOLS=1 时注册） ===
    if (DEV_TOOLS) {
      this.onAction("__devSaveState", (client, data: { label?: string }) => {
        const snapshot = captureState(this.state, data?.label);
        client.send("__devSnapshot", snapshot);
        console.log(`[DEV] ${client.sessionId} 导出局面快照 (${this.state.units.size} 单位)`);
      });

      this.onAction("__devLoadState", (client, data: { snapshot: StateSnapshot }) => {
        const result = restoreState(this.state, data?.snapshot);
        // 快照里的 id 是上一局生成的，计数器必须跳到它们之后，
        // 否则接下来新建的单位会撞上已存在的 id（MapSchema 会被静默覆盖）
        this.syncUnitIdCounter();
        console.log(`[DEV] ${client.sessionId} 载入局面:`, result.message);
        if (result.unknownFields.length > 0) {
          console.warn('[DEV] 快照含当前 schema 不认识的字段:', result.unknownFields);
        }
        if (result.ok) {
          this.addBattleLog(`[开发] ${result.message}`);
          this.broadcast("info", { message: result.message });
          this.broadcast("phaseChange", { phase: this.state.phase });
          // 载入的是一个已开局的局面时补发 gameStart：
          // 客户端大厅是等这条消息才进棋盘的，否则一个人调试会一直卡在「恭候对手」。
          if (this.state.phase !== "general_select") {
            this.broadcast("gameStart", { message: "[开发] 载入局面" });
          }
        } else {
          client.send("error", { message: `载入失败：${result.message}` });
        }
      });

      console.log('[DEV] 开发工具已启用：__devSaveState / __devLoadState');
    }
  }

  /**
   * 获取客户端的玩家角色
   */
  /**
   * 同机轮流专用：设置阶段（选将/配兵/大本营）里一方做完后把行动方交给另一方。
   *
   * 联网模式下双方是「同时各自操作自己那一侧」，`currentPlayer` 在这三个阶段不需要变；
   * 同机轮流只有一个客户端，而它的角色由 `getPlayerRole` 按 `currentPlayer` 返回，
   * 所以必须显式交接，否则第二次操作会被判成「已经选择过了」而卡住。
   *
   * @param phaseAdvanced 本次操作是否已让阶段推进（双方都做完了）
   */
  private hotseatAfterSetupAction(phaseAdvanced: boolean) {
    if (!this.isHotseat) return;
    this.state.currentPlayer = phaseAdvanced
      ? "player1"                                            // 进入下一阶段，从玩家一开始
      : (this.state.currentPlayer === "player1" ? "player2" : "player1");
  }

  private getPlayerRole(client: Client): 'player1' | 'player2' | null {
    // 同机轮流：这个客户端永远就是当前行动方，
    // 因此所有 `role !== currentPlayer` 的回合校验自然成立，无需逐个改。
    if (this.isHotseat) {
      return this.playerRoles.has(client.sessionId)
        ? (this.state.currentPlayer as 'player1' | 'player2')
        : null;
    }

    const role = this.playerRoles.get(client.sessionId);
    // 观战者返回 null，只有玩家可以操作
    return (role === 'player1' || role === 'player2') ? role : null;
  }

  /**
   * 添加战斗日志
   */
  /**
   * 内部标识符 → 中文显示名。
   *
   * 战报现在是直接显示给玩家的（以前只存在服务端、客户端另画一份自己猜的），
   * 所以不该出现 `player1移动infantry到(1,1,-2)` 这种字样。
   *
   * 在 addBattleLog 这一个出口统一翻译，而不是去改 144 处模板字符串 ——
   * 标识符是一个固定小集合，边界替换一次就全覆盖了。
   * `\b` 把下划线算作单词字符，所以 `\bneutral\b` 不会误伤 `neutral_marker`。
   */
  private static readonly LOG_TERMS: Array<[RegExp, string]> = [
    [/\bneutral_marker\b/g, '中立标记'],
    [/\bhuangjin_lishi\b/g, '黄巾力士'],
    [/\bhuangjin_zei\b/g, '黄巾贼'],
    [/\bplayer1\b/g, '玩家1'],
    [/\bplayer2\b/g, '玩家2'],
    [/\bneutral\b/g, '中立'],
    [/\binfantry\b/g, '步兵'],
    [/\bcavalry\b/g, '骑兵'],
    [/\barcher\b/g, '弓箭手'],
    [/\bgeneral\b/g, '将军'],
    [/\bballista\b/g, '弩车'],
    [/\bchariot\b/g, '战车'],
    [/\bcatapult\b/g, '投石车'],
  ];

  /** 把战报文本里的内部标识符换成中文 */
  private humanizeLog(message: string): string {
    let out = message;
    for (const [re, zh] of ShiyuanRoom.LOG_TERMS) {
      out = out.replace(re, zh);
    }
    return out;
  }

  private addBattleLog(message: string) {
    this.state.battleLog.push(this.humanizeLog(message));
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
  private handleSelectGeneral(client: Client, data: { general: string }) {
    const role = this.getPlayerRole(client);
    if (!role) return;

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
    } else {
      if (this.state.player2General) {
        client.send("error", { message: "已经选择过将领了" });
        return;
      }
      this.state.player2General = data.general;
      this.addBattleLog(`玩家2选择了${this.getGeneralName(data.general)}将军`);
    }

    // 检查是否都选完了
    const bothPicked = !!(this.state.player1General && this.state.player2General);
    if (bothPicked) {
      this.state.phase = "army_build";
      this.addBattleLog("进入配兵阶段");
      this.broadcast("phaseChange", { phase: "army_build" });
    }
    this.hotseatAfterSetupAction(bothPicked);
  }

  /**
   * 处理配兵
   */
  private handleBuildArmy(client: Client, data: { infantry: number, cavalry: number, archer: number }) {
    const role = this.getPlayerRole(client);
    if (!role) return;

    if (this.state.phase !== "army_build") {
      client.send("error", { message: "当前不是配兵阶段" });
      return;
    }

    // 验证预算（4元 = 40角）
    const cost = data.infantry * 1 + data.cavalry * 2 + data.archer * 5;
    if (cost !== 40) {
      client.send("error", { message: `预算必须是4元（40角），当前是${cost/10}元` });
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
    } else {
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

    const bothDone = player1Done && player2Done;
    if (bothDone) {
      this.state.phase = "base_setup";
      this.addBattleLog("进入大本营设置阶段");
      this.broadcast("phaseChange", { phase: "base_setup" });
    }
    this.hotseatAfterSetupAction(bothDone);
  }

  /**
   * 处理设置大本营
   */
  private handleSetupBase(client: Client, data: { q: number, r: number, s: number }) {
    const role = this.getPlayerRole(client);
    if (!role) return;

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
    } else {
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

    const bothDone = player1Done && player2Done;
    if (bothDone) {
      this.state.phase = "deploy";
      this.addBattleLog("进入部署阶段 - 玩家1先部署");
      this.broadcast("phaseChange", { phase: "deploy" });
    }
    this.hotseatAfterSetupAction(bothDone);
  }

  /**
   * 处理部署单位
   */
  private handleDeployUnit(client: Client, data: any) {
    const role = this.getPlayerRole(client);
    if (!role) return;

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
    const occupied = Array.from(this.state.units.values()).some(u =>
      u.q === position.q && u.r === position.r && u.s === position.s
    );

    if (occupied) {
      client.send("error", { message: "该位置已被占用" });
      return;
    }

    // 检查是否被机关单位占据
    if (this.isHexOccupiedByMachine(position)) {
      client.send("error", { message: "该位置被机关单位占据，无法部署" });
      return;
    }

    // 验证位置是否在起始区
    const playerSide = role === "player1" ? "top" : "bottom";
    if (!isInStartZone(position, playerSide)) {
      client.send("error", { message: "只能在己方起始区（底部三排）部署单位" });
      return;
    }

    // 验证库存：检查是否还有该类型的单位可以部署（基于已消耗库存而非场上数量）
    if (unitType === "infantry" || unitType === "cavalry" || unitType === "archer" || unitType === "general") {
      // 获取该玩家该类型单位的已消耗库存和配置上限
      let consumedCount = 0;
      let maxCount = 0;

      if (role === "player1") {
        if (unitType === "infantry") {
          consumedCount = this.state.player1ConsumedInfantry;
          maxCount = this.state.player1Infantry;
        } else if (unitType === "cavalry") {
          consumedCount = this.state.player1ConsumedCavalry;
          maxCount = this.state.player1Cavalry;
        } else if (unitType === "archer") {
          consumedCount = this.state.player1ConsumedArcher;
          maxCount = this.state.player1Archer;
        } else if (unitType === "general") {
          // 将军消耗1个步兵库存
          consumedCount = this.state.player1ConsumedInfantry;
          maxCount = this.state.player1Infantry;
        }
      } else {
        if (unitType === "infantry") {
          consumedCount = this.state.player2ConsumedInfantry;
          maxCount = this.state.player2Infantry;
        } else if (unitType === "cavalry") {
          consumedCount = this.state.player2ConsumedCavalry;
          maxCount = this.state.player2Cavalry;
        } else if (unitType === "archer") {
          consumedCount = this.state.player2ConsumedArcher;
          maxCount = this.state.player2Archer;
        } else if (unitType === "general") {
          // 将军消耗1个步兵库存
          consumedCount = this.state.player2ConsumedInfantry;
          maxCount = this.state.player2Infantry;
        }
      }

      // 检查是否超过库存：剩余 = 配置上限 - 已消耗
      if (consumedCount >= maxCount) {
        const unitName = unitType === "general" ? "步兵（部署将军需要）" : unitType;
        client.send("error", { message: `${unitName}单位库存已耗尽，无法部署` });
        return;
      }
    }

    // 将军只能部署一个
    if (unitType === "general") {
      const hasGeneral = Array.from(this.state.units.values()).some(u =>
        u.owner === role && u.type === "general"
      );
      if (hasGeneral) {
        client.send("error", { message: "将军已部署，不能重复部署" });
        return;
      }
    }

    // 创建单位
    const unit = new UnitSchema();
    unit.id = this.newUnitId(unitType);
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
      } else if (generalType === "rende") {
        unit.maxHp = 4;
        unit.hp = 4;
      } else {
        // shenji / taiping
        unit.maxHp = 3;
        unit.hp = 3;
      }
    }

    // 添加到地图
    this.state.units.set(unit.id, unit);

    // 增加已消耗库存（三个基础兵种，将军不占库存）
    if (unitType === "infantry" || unitType === "cavalry" || unitType === "archer") {
      if (role === "player1") {
        if (unitType === "infantry") {
          this.state.player1ConsumedInfantry++;
        } else if (unitType === "cavalry") {
          this.state.player1ConsumedCavalry++;
        } else if (unitType === "archer") {
          this.state.player1ConsumedArcher++;
        }
      } else {
        if (unitType === "infantry") {
          this.state.player2ConsumedInfantry++;
        } else if (unitType === "cavalry") {
          this.state.player2ConsumedCavalry++;
        } else if (unitType === "archer") {
          this.state.player2ConsumedArcher++;
        }
      }
    }

    // 扣除行动点
    if (role === "player1") {
      this.state.player1ActionPoints -= 1;
    } else {
      this.state.player2ActionPoints -= 1;
    }

    this.addBattleLog(`${role === "player1" ? "玩家1" : "玩家2"}部署了${unitType}于(${position.q},${position.r},${position.s})`);
    client.send("info", { message: "部署成功" });

    // 累加部署价值（不会因单位死亡而减少）
    const unitValue = this.getUnitValue(unitType);
    if (role === "player1") {
      this.state.player1DeployedValue += unitValue;
    } else {
      this.state.player2DeployedValue += unitValue;
    }

    // 作乱：部署按**落点**判定。单位此刻才上场，所以没有「效果生效前」可言 ——
    // 效果就是「它站在这里」，于是落地即吃伤害。
    // 部署的单位最低 2 血（将领 3-4 血），1 点打不死，所以不会出现
    // 「付了行动点却什么都没放下」的情况。
    this.applyZuoluan(unit);

    // 注意：部署阶段不自动切换回合，即使行动点耗尽也要等玩家手动点击"结束回合"
  }

  /**
   * 获取单位价值（元）
   */
  private getUnitValue(unitType: string): number {
    if (unitType === "infantry") return 0.1;
    if (unitType === "cavalry") return 0.2;
    if (unitType === "archer") return 0.5;
    if (unitType === "ballista") return 0.9;
    if (unitType === "chariot") return 0.6;
    return 0; // 将军不计入
  }

  /**
   * 处理完成部署
   */
  private handleFinishDeploy(client: Client) {
    const role = this.getPlayerRole(client);
    if (!role || role !== this.state.currentPlayer) return;

    // 切换到另一个玩家部署
    if (this.state.currentPlayer === "player1") {
      // 玩家1完成部署，轮到玩家2
      this.state.currentPlayer = "player2";
      this.addBattleLog("玩家1完成部署，轮到玩家2");

      // 重置玩家1的行动点（先手部署阶段不需要行动点）
      this.state.player1ActionPoints = 0;
    } else {
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
  private handleRollDice(client: Client) {
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
      } else {
        // 玩家2（后手）骰子数 = 1 + 玩家1已部署单位总价值（元）的整数部分
        const deployedValue = this.state.player1DeployedValue;

        const diceCount = 1 + Math.floor(deployedValue); // 基础1颗 + 每1元1颗

        // 投骰子
        const results: number[] = [];
        for (let i = 0; i < diceCount; i++) {
          results.push(this.rollD6());
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
  private rollDiceForPlayer(role: "player1" | "player2") {
    // 黄天当立：对手的一个完整回合已经过去，条件仍成立则此刻直接取胜。
    // 放在掷骰之前 —— 已经赢了就不该再走掷骰（骰子为 0 还会判负）。
    if (this.resolveHuangtianDeclaration(role)) return;

    // 调试：检查所有单位的定身状态
    console.log(`\n[定身调试] rollDiceForPlayer 开始 - ${role}的回合`);
    this.state.units.forEach((unit) => {
      if (unit.cannotMoveNextTurn || unit.cannotRotateNextTurn) {
        console.log(`[定身调试] 单位 ${unit.id} (${unit.owner}, ${unit.type}): cannotMove=${unit.cannotMoveNextTurn}, cannotRotate=${unit.cannotRotateNextTurn}`);
      }
    });

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
      // 这条结局原先只发 phaseChange，客户端结算画面拿不到胜方，补上 gameEnd
      this.broadcast("gameEnd", {
        winner,
        message: `${role === "player1" ? "玩家1" : "玩家2"}骰子数为0`,
      });
      return;
    }

    // 投骰子（服务器生成随机数）
    const results: number[] = [];
    for (let i = 0; i < diceCount; i++) {
      results.push(this.rollD6()); // 1-6
    }

    // 计算行动点
    const actionPoints = results.reduce((sum, val) => sum + val, 0);

    if (role === "player1") {
      this.state.player1Dice = diceCount;
      this.state.player1DiceResults.clear();
      results.forEach(r => this.state.player1DiceResults.push(r));
      this.state.player1ActionPoints = actionPoints;
    } else {
      this.state.player2Dice = diceCount;
      this.state.player2DiceResults.clear();
      results.forEach(r => this.state.player2DiceResults.push(r));
      this.state.player2ActionPoints = actionPoints;
    }

    this.addBattleLog(`${role === "player1" ? "玩家1" : "玩家2"}投骰：${diceCount}颗骰子(基础${baseDice}+部署${Math.floor(deployedValue / 2)})，点数${results.join(',')}，共${actionPoints}点行动值`);

    // 太平：新回合开始，符水粥的每回合额度回满
    this.taipingOf(role).fushuiUsedThisTurn = false;

    // 太平：回合开始、掷骰之后刷新公共平民，紧接着强制豆饭（§7.1 第 2、3 步）。
    // 顺序不能换：新刷出来的平民**可以**立刻成为本回合的征募目标。
    this.refreshCivilians(role);
    // 太平活着走豆饭，死了走腐化 —— 两者互斥，各自内部会判断
    this.startDoufanPhase(role);
    this.startCorruptPhase(role);
  }

  /**
   * 处理重投骰子
   */
  private handleRerollDice(client: Client, data: { diceIndex: number }) {
    const role = this.getPlayerRole(client);
    if (!role || role !== this.state.currentPlayer) return;

    const tokens = role === "player1" ? this.state.player1RerollTokens : this.state.player2RerollTokens;
    if (tokens <= 0) {
      client.send("error", { message: "没有重投次数了" });
      return;
    }

    // 重投指定的骰子
    const newValue = this.rollD6();

    if (role === "player1") {
      const oldValue = this.state.player1DiceResults[data.diceIndex];
      this.state.player1DiceResults[data.diceIndex] = newValue;
      this.state.player1RerollTokens--;
      // 重新计算行动点
      this.state.player1ActionPoints = Array.from(this.state.player1DiceResults).reduce((sum, v) => sum + v, 0);
      this.addBattleLog(`玩家1重投：${oldValue}→${newValue}`);
    } else {
      const oldValue = this.state.player2DiceResults[data.diceIndex];
      this.state.player2DiceResults[data.diceIndex] = newValue;
      this.state.player2RerollTokens--;
      this.state.player2ActionPoints = Array.from(this.state.player2DiceResults).reduce((sum, v) => sum + v, 0);
      this.addBattleLog(`玩家2重投：${oldValue}→${newValue}`);
    }
  }

  /** 该格是否被机关车身占用。规则实现见 shared/rules/queries.ts */
  private isHexOccupiedByMachine(hex: { q: number; r: number; s: number }): boolean {
    return Rules.isHexOccupiedByMachine(hex, this.unitList);
  }

  /** 同上但排除指定单位。规则实现见 shared/rules/queries.ts */
  private isHexOccupiedByMachineExcluding(hex: { q: number; r: number; s: number }, excludeId: string): boolean {
    return Rules.isHexOccupiedByMachineExcluding(hex, excludeId, this.unitList);
  }

  /**
   * 汇总当前行动方每个单位的合法移动与可攻击目标，供客户端直接用来画高亮。
   *
   * 不能放进 GameStateSchema —— 它已经正好 64 个字段，是 Colyseus 的上限，
   * 所以只能作为消息下发。
   *
   * 移动格子编码成 [q, r, steps, flags] 四元组：s 可由 -q-r 推出，省掉一半体积。
   *
   * flags 是位掩码，告诉客户端「落在这一格会有什么后果」：
   *   1  MOVE_FLAG_DAMAGE_UP  伤害 +1
   *   2  MOVE_FLAG_NO_ATTACK  本回合不能攻击
   *
   * 为什么由服务端给而不是客户端按 steps 自己推：这两条后果是**规则**
   * （见 handleMove 的骑兵分支与 handleAttack 的伤害计算），数值住在服务端。
   * 客户端写一份 `steps===2 → 伤害+1` 看着没问题，但服务端改数值时两边立刻漂移。
   */
  private buildValidActions() {
    const forPlayer = this.state.currentPlayer as 'player1' | 'player2';
    const moves: Record<string, Array<[number, number, number, number]>> = {};
    const attacks: Record<string, string[]> = {};
    /**
     * attacks 的子集：这一下打下去能直接击杀的目标。
     * 客户端据此把矛尖画成实心（空心 = 打得到，实心 = 这一下能杀），
     * 玩家不用自己算血量。
     *
     * 伤害数值走 Rules.predictDamage —— 和 handleAttack 落伤害时**同一份实现**，
     * 否则会出现「画了实心矛尖却没杀掉」。
     */
    const lethal: Record<string, string[]> = {};
    const attackHexes: Record<string, Array<[number, number]>> = {};

    this.state.units.forEach((unit, id) => {
      if (!this.canCommandUnit(unit, forPlayer)) return;

      const m = this.getValidMoves(unit);
      if (m.length > 0) {
        moves[id] = m.map(h => {
          const steps = h.steps ?? 1;
          // 只有骑兵有「移动距离影响后续动作」这条规则：
          // handleMove 只对 type==='cavalry' 记 moveDistance，
          // handleAttack 的冲锋加成也只判 cavalry。战车虽然「如骑兵般移动」，
          // 但服务端并不给它记 moveDistance，所以这里不能一视同仁。
          let flags = 0;
          if (unit.type === 'cavalry') {
            if (steps === 2) flags |= Rules.MOVE_FLAG_DAMAGE_UP;
            if (steps === 3) flags |= Rules.MOVE_FLAG_NO_ATTACK;
          }
          // 落在这一格会被相邻的充能黄巾贼作乱。
          // 用「把单位假想搬到落点再问规则」的办法算，而不是客户端自己
          // 按坐标推 —— 贼的威胁判定（体积相邻、贼对贼豁免）只有一份实现。
          const probe = { ...(unit as unknown as Rules.UnitLike), q: h.q, r: h.r, s: -h.q - h.r };
          if (Rules.wouldTriggerZuoluan(probe, this.unitList)) {
            flags |= Rules.MOVE_FLAG_ZUOLUAN;
          }
          return [h.q, h.r, steps, flags] as [number, number, number, number];
        });
      }

      const a = this.getAttackableTargets(unit);
      if (a.length > 0) {
        attacks[id] = a;
        const deadly = a.filter(targetId => {
          const t = this.state.units.get(targetId);
          return !!t && Rules.isLethal(
            unit as unknown as Rules.UnitLike,
            t as unknown as Rules.UnitLike,
            this.unitList
          );
        });
        if (deadly.length > 0) lethal[id] = deadly;
      }

      // 机关的「范围型」攻击高亮：不是打某个目标，而是覆盖一条线
      const hexes = this.getAttackRangeHexes(unit);
      if (hexes.length > 0) {
        attackHexes[id] = hexes.map(h => [h.q, h.r] as [number, number]);
      }
    });

    /**
     * 敌方（= 非行动方）下回合能打到的格子，客户端铺朱色斜纹。
     *
     * 答案由 Rules.getThreatHexes 委派给 checkAttackLegality —— 和校验同一份规则。
     * 不含战车碾压（它靠移动杀人，不是攻击动作），所以这张图是**偏保守的**：
     * 少报不多报，不会骗玩家说某格安全。
     *
     * 开销：每个敌方单位对全图 91 格各问一次。只在 validActionsFingerprint
     * 变化时重算，而该指纹已覆盖所有单位的位置 / 朝向 / 体力。
     */
    const foe = forPlayer === 'player1' ? 'player2' : 'player1';
    const threatHexes = Rules.getThreatHexesForOwner(foe, this.unitList)
      .map(h => [h.q, h.r] as [number, number]);

    /**
     * 当前被纵深抗击保护着的单位 id（客户端给队首亮盾）。
     * 不是含糊的「在方阵里」—— 而是「场上真有某个敌方弓箭手，打它会被免伤」。
     */
    const depthDefended = Rules.getDepthDefendedUnitIds(this.unitList);

    /**
     * 太平的符水粥可救济目标（平民 id）。
     *
     * 和 moves / attacks 一样走 validActions 消息而不进 Schema
     * —— 顶层字段数有上限，而且这类派生数据本来就不该存。
     */
    const taipingGeneral = this.taipingGeneralOf(forPlayer);
    const fushuiTargets = taipingGeneral
      ? Rules.getFushuiTargets(
          taipingGeneral as unknown as Rules.UnitLike,
          this.unitList,
          this.taipingOf(forPlayer).fushuiUsedThisTurn
        )
      : [];

    return {
      forPlayer, phase: this.state.phase,
      moves, attacks, lethal, attackHexes,
      threatHexes, depthDefended,
      /**
       * 所有充能黄巾贼的相邻格。含义是「在这里行动会挨 1 点作乱伤害」，
       * 和 threatHexes（敌方下回合能打到哪）是两件事，所以分开。
       */
      zuoluanHexes: Rules.getZuoluanThreatHexes(this.unitList)
        .map(h => [h.q, h.r] as [number, number]),
      fushuiTargets,
      /**
       * 强制腐化阶段：每只待办的贼各自能腐化哪些相邻平民。
       * 队列本身（pendingCorrupt）是 Schema 同步字段，客户端直接读；
       * 这里补的是「这只贼点下去有哪些目标」，省得客户端自己算相邻。
       */
      corruptTargets: Object.fromEntries(
        Array.from(this.taipingOf(forPlayer).pendingCorrupt).map(zid => {
          const z = this.state.units.get(zid);
          return [
            zid,
            z ? Rules.getCorruptTargets(z as unknown as Rules.UnitLike, this.unitList) : [],
          ];
        })
      ) as Record<string, string[]>,
      /**
       * 黄天当立的四条件清单（界面逐条打勾）+ 当前是否已在宣告中。
       * 非太平方拿到 null。
       */
      huangtian: taipingGeneral
        ? {
            ...this.huangtianConditionsOf(forPlayer),
            declaredTurn: this.taipingOf(forPlayer).huangtianDeclaredTurn,
          }
        : null,
    };
  }

  /** 机关的范围型攻击覆盖格。规则实现见 shared/rules/queries.ts */
  private getAttackRangeHexes(unit: UnitSchema): HexCoord[] {
    return Rules.getAttackRangeHexes(unit);
  }

  /**
   * 状态指纹：只包含会影响合法动作的字段。
   *
   * onBeforePatch 每个 patch tick 都会被调用（约 20 次/秒），而且是在
   * 「检查有没有变化」之前调用，所以必须自己判断要不要重算，
   * 否则会每秒算 20 遍全场单位的合法动作。
   */
  private validActionsFingerprint(): string {
    const parts: string[] = [
      this.state.phase,
      this.state.currentPlayer,
      String(this.state.player1ActionPoints),
      String(this.state.player2ActionPoints),
      // 符水粥的「本回合已用」会改变可救济目标。实际上用掉它也会同时改动
      // 太平的 hasAttacked / actionsThisTurn，但靠那个巧合来触发重算太脆了
      `${this.state.player1Taiping.fushuiUsedThisTurn ? 1 : 0}`,
      `${this.state.player2Taiping.fushuiUsedThisTurn ? 1 : 0}`,
    ];
    this.state.units.forEach((u, id) => {
      parts.push(
        `${id},${u.q},${u.r},${u.s},${u.hp},${u.actionsThisTurn},` +
        `${u.hasMoved ? 1 : 0},${u.hasAttacked ? 1 : 0},${u.hasActedThisTurn ? 1 : 0},` +
        `${u.chargeLevel},${u.movementRestricted ? 1 : 0},${u.unlimitedActions ? 1 : 0},${u.bonusActionLimit},` +
        // direction 必须在内：投石车的射击线、弩车的贯穿方向都跟着朝向变，
        // 漏掉它的话转向之后不会重算，客户端会拿着旧的高亮
        // charged 必须在内：贼的充能一耗尽，作乱威胁格和移动落点标记都要变
        `${u.direction},${u.hasRotated ? 1 : 0},${u.charged ? 1 : 0}`
      );
    });
    return parts.join('|');
  }

  /**
   * Colyseus 在每次广播状态补丁前调用。
   * 只有在影响合法动作的状态真的变了时，才重算并下发。
   */
  onBeforePatch() {
    const fp = this.validActionsFingerprint();
    if (fp === this.lastValidActionsFingerprint) return;
    this.lastValidActionsFingerprint = fp;
    this.broadcast("validActions", this.buildValidActions());
  }

  /** 普通攻击合法性。规则实现见 shared/rules/queries.ts */
  private checkAttackLegality(attacker: UnitSchema, target: UnitSchema) {
    return Rules.checkAttackLegality(attacker, target, this.unitList);
  }

  /** 单位占据的格子。规则实现见 shared/rules/queries.ts */
  private occupiedHexesOf(unit: UnitSchema): HexCoord[] {
    return Rules.occupiedHexesOf(unit);
  }

  /** 弩车近战合法性。规则实现见 shared/rules/queries.ts */
  private checkBallistaMeleeLegality(ballista: UnitSchema, target: UnitSchema) {
    return Rules.checkBallistaMeleeLegality(ballista, target, this.unitList);
  }

  /** 可攻击目标 id 列表。规则实现见 shared/rules/queries.ts */
  private getAttackableTargets(unit: UnitSchema): string[] {
    return Rules.getAttackableTargets(unit, this.unitList);
  }

  /** 合法移动位置。规则实现见 shared/rules/queries.ts */
  private getValidMoves(unit: UnitSchema): { q: number; r: number; s: number; steps?: number }[] {
    return Rules.getValidMoves(unit, this.unitList);
  }

  /**
   * 通用：处理战车死亡，生成2个不可行动的步兵
   * @param chariot 被击杀的战车
   * @returns 是否成功处理（战车崩毁逻辑）
   */
  private handleChariotDeath(chariot: UnitSchema): void {
    const chariotPos = { q: chariot.q, r: chariot.r, s: chariot.s };

    // 战车崩毁：如果击杀过敌人，神机将军拥有者获得重投机会
    if ((chariot as any).killCount > 0) {
      if (chariot.owner === "player1") {
        this.state.player1RerollTokens++;
      } else {
        this.state.player2RerollTokens++;
      }
      this.addBattleLog(`战车崩毁，${chariot.owner === "player1" ? "玩家1" : "玩家2"}获得1次重投机会`);
    }

    // 战车崩毁后，原地生成2个满血步兵（不可行动）
    const infantry1 = new UnitSchema();
    infantry1.id = this.newUnitId('infantry');
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

    // 第二个步兵：寻找相邻空位（排除战车自身，因为战车还未从 units 中删除）
    const neighbors = hexNeighbors(chariotPos);
    const emptyPos = neighbors.find((pos: { q: number; r: number; s: number }) => {
      // 检查是否有单位占用（排除战车本身）
      const occupied = Array.from(this.state.units.values()).some(u =>
        u.id !== chariot.id && u.q === pos.q && u.r === pos.r && u.s === pos.s
      );
      // 检查是否被机关单位占据（排除战车自身的体积格子）
      const occupiedByMachine = this.isHexOccupiedByMachineExcluding(pos, chariot.id);
      return !occupied && !occupiedByMachine && isInMapRange(pos, 5);
    });

    if (emptyPos) {
      const infantry2 = new UnitSchema();
      infantry2.id = this.newUnitId('infantry');
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
    } else {
      this.addBattleLog(`战车崩毁为1个满血步兵（无相邻空位）`);
    }
  }

  /**
   * 处理移动单位
   */
  private handleMoveUnit(client: Client, data: { unitId: string, toQ: number, toR: number, toS: number }) {
    const role = this.getPlayerRole(client);
    if (!role || role !== this.state.currentPlayer) {
      client.send("error", { message: "不是你的回合" });
      return;
    }

    const unit = this.state.units.get(data.unitId);
    if (!unit || !this.canCommandUnit(unit, role)) {
      client.send("error", { message: "这不是你的单位" });
      return;
    }

    // 检查是否被定身（无法移动）
    if (unit.cannotMoveNextTurn) {
      client.send("error", { message: "该单位被定身，无法移动" });
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
    const isValidMove = validMoves.some(hex => hexEquals(hex, targetPos));

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
    } else {
      if (this.state.player2ActionPoints < 1) {
        client.send("error", { message: "行动点不足" });
        return;
      }
      this.state.player2ActionPoints--;
    }

    // 执行移动
    const oldPos = { q: unit.q, r: unit.r, s: unit.s };
    unit.q = data.toQ;
    unit.r = data.toR;
    unit.s = data.toS;
    unit.hasMoved = true;
    unit.actionsThisTurn = (unit.actionsThisTurn || 0) + 1; // 增加行动次数

    // 骑兵：记录移动距离
    if (unit.type === 'cavalry') {
      const targetPos = { q: data.toQ, r: data.toR, s: data.toS };
      const moveDistance = hexDistance(oldPos, targetPos);
      unit.moveDistance = moveDistance;

      // 移动3格则不能攻击
      if (moveDistance === 3) {
        unit.hasAttacked = true; // 标记为已攻击，阻止本回合攻击
        this.addBattleLog(`骑兵移动3格，本回合无法攻击`);
      }
    }

    // 机关单位（弩车、战车）移动后标记已行动（投石车用 actionsThisTurn 计数，不走此分支）
    if (unit.type === 'ballista' || unit.type === 'chariot') {
      unit.hasActedThisTurn = true;
    }

    this.addBattleLog(`${role}移动${unit.type}到(${data.toQ},${data.toR},${data.toS})`);
    console.log(`[DEBUG] 移动前 - currentPlayer: ${this.state.currentPlayer}, role: ${role}, unit.owner: ${unit.owner}, unit.type: ${unit.type}, unit.id: ${unit.id}`);

    // 战车碾压：检查移动路径上是否有敌方单位
    if (unit.type === 'chariot') {
      const chariotOccupiedHexes = getMachineOccupiedHexes(targetPos, 'chariot');

      // 查找所有被战车占据格子上的敌方单位（包括机关单位的体积）
      const crushedUnits: any[] = [];
      const crushedMachines: any[] = []; // 记录被碾压的机关单位

      chariotOccupiedHexes.forEach(hex => {
        // 检查普通单位和将军
        const enemyUnit = Array.from(this.state.units.values()).find(u =>
          u.owner !== role && u.q === hex.q && u.r === hex.r && u.s === hex.s
        );
        if (enemyUnit && !crushedUnits.includes(enemyUnit)) {
          crushedUnits.push(enemyUnit);
        }

        // 检查机关单位的体积
        Array.from(this.state.units.values()).forEach(u => {
          if (u.owner !== role && (u.type === 'ballista' || u.type === 'chariot')) {
            const machineType = u.type === 'ballista' ? 'ballista' : 'chariot';
            const machineOccupiedHexes = getMachineOccupiedHexes({ q: u.q, r: u.r, s: u.s }, machineType);
            const isCrushed = machineOccupiedHexes.some(machineHex => hexEquals(machineHex, hex));
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
          } else {
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
        this.killUnit(crushedUnit);
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
          } else {
            this.state.player2Dice = Math.max(0, this.state.player2Dice - 1);
            this.state.player2LostDice++;
          }
          this.addBattleLog(`${crushedUnit.owner}的将军被击杀，永久失去1颗骰子！`);
        }

        // 首次击杀奖励（只对敌方单位）
        if (crushedUnit.owner !== role) {
          this.grantFirstKillReward(role, crushedUnit);
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

    // 黄巾贼：主动移动结束时重新充满作乱充能。
    //
    // 只认这条路径，所以被击退、被动位移不会回充 —— 规则明确要求如此。
    // 一次移动即可充满，不需要连续移动，也不额外消耗行动点。
    if (unit.type === "huangjin_zei" && !unit.charged) {
      unit.charged = true;
      this.addBattleLog(`黄巾贼${unit.id}移动后重新积蓄作乱之势`);
    }

    // 作乱：移动只检查**终点**（起点旁边有贼、走开了就不算）。
    //
    // 必须排在夺营判定之前（§9.1）：冲进敌方大本营的单位要先吃这 1 点伤害，
    // 活下来才算赢。顺序写反的话，被作乱打死的单位照样能赢。
    if (this.applyZuoluan(unit)) return;

    // 检查胜利条件：是否触碰到敌方大本营
    this.checkVictoryCondition(unit);
  }

  /**
   * 检查胜利条件和战车触底
   */
  private checkVictoryCondition(unit: any) {
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
      const occupiedHexes = getMachineOccupiedHexes({ q: unit.q, r: unit.r, s: unit.s }, machineType);
      console.log(`[DEBUG checkVictoryCondition] 机关单位占用格子:`, occupiedHexes);
      reachedBase = occupiedHexes.some(hex => hexEquals(hex, enemyBase));
    } else {
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
  private handleChariotReachEnemyZone(chariot: any) {
    const role = chariot.owner;
    const chariotPos = { q: chariot.q, r: chariot.r, s: chariot.s };
    const remainingHp = chariot.hp;

    // 删除战车
    this.state.units.delete(chariot.id);
    this.addBattleLog(`战车触底！剩余${remainingHp}点血量转为${remainingHp}点行动值，崩解为2个可行动的步兵`);

    // 将剩余血量转为行动点
    if (role === "player1") {
      this.state.player1ActionPoints += remainingHp;
    } else {
      this.state.player2ActionPoints += remainingHp;
    }

    // 生成第一个步兵（原位置，可行动）
    const infantry1 = new UnitSchema();
    infantry1.id = this.newUnitId('infantry');
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
    const neighbors = hexNeighbors(chariotPos);
    const emptyPos = neighbors.find((pos: { q: number; r: number; s: number }) => {
      const occupied = Array.from(this.state.units.values()).some(u =>
        u.q === pos.q && u.r === pos.r && u.s === pos.s
      );
      const occupiedByMachine = this.isHexOccupiedByMachine(pos);
      return !occupied && !occupiedByMachine && isInMapRange(pos, 5);
    });

    if (emptyPos) {
      const infantry2 = new UnitSchema();
      infantry2.id = this.newUnitId('infantry');
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
    } else {
      this.addBattleLog(`战车触底崩解：生成1个满血可行动步兵（无相邻空位），获得${remainingHp}点行动值`);
    }
  }

  /**
   * 处理攻击单位
   */
  private handleAttackUnit(client: Client, data: { attackerId: string, targetId: string }) {
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

    if (!this.canCommandUnit(attacker, role)) {
      client.send("error", { message: "这不是你的单位" });
      return;
    }

    const attackerPos = { q: attacker.q, r: attacker.r, s: attacker.s };
    const targetPos   = { q: target.q,   r: target.r,   s: target.s   };

    // === 攻击合法性校验 ===
    // 这段逻辑抽成了 checkAttackLegality，因为 getAttackableTargets 也要用同一份判断
    // 来算「哪些目标可以打」下发给客户端。以前客户端自己算一遍高亮、服务端算一遍校验，
    // 两边不一致就会出现「高亮了却点不动」。
    const legality = this.checkAttackLegality(attacker, target);
    if (!legality.ok) {
      client.send("error", { message: legality.reason });
      return;
    }

    // 战报是副作用，不能放进谓词里（否则算高亮时会刷屏）
    if (legality.archerBlocked) {
      this.addBattleLog(`弓箭手射击路径被友军阻挡，行动点+1`);
    }

    const actionCost = legality.cost;

    // 检查行动点是否足够
    if (role === "player1") {
      if (this.state.player1ActionPoints < actionCost) {
        client.send("error", { message: "行动点不足" });
        return;
      }
      this.state.player1ActionPoints -= actionCost;
    } else {
      if (this.state.player2ActionPoints < actionCost) {
        client.send("error", { message: "行动点不足" });
        return;
      }
      this.state.player2ActionPoints -= actionCost;
    }


    // 作乱：非移动行动在**效果生效前**结算，判定行动单位当前所在位置。
    // 已支付的行动点不返还（规则明确），所以放在扣点之后。
    if (this.applyZuoluan(attacker)) return;

    // === 步兵纵深抗击和击退传导机制（仅对弓箭手攻击有效）===
    //
    // 「背后有没有连续的己方步兵」这段判定已经抽到 shared/rules/queries.ts，
    // 因为 buildValidActions 要用同一份计算来判断「这一下能不能杀」（lethal）。
    // 这里只留副作用：击退传导、设移动限制、写战报。
    let depthDefenseTriggered = false;
    if (target.type === 'infantry' && attacker.type === 'archer') {
      const source_cell = { q: attacker.q, r: attacker.r, s: attacker.s };
      const rearInfantries = Rules.findRearInfantrySupport(
        attacker as unknown as Rules.UnitLike,
        target as unknown as Rules.UnitLike,
        this.unitList
      ) as unknown as Array<{ unit: UnitSchema; distance: number }>;

      if (rearInfantries.length > 0) {
        depthDefenseTriggered = true;
        this.addBattleLog(`纵深抗击触发！${target.owner}的步兵后方有支援`);

        // 找到最远的后排步兵
        const rearmost = rearInfantries.sort((a, b) => b!.distance - a!.distance)[0]!;
        const rearUnit = rearmost.unit;

        // 使用击退传导机制
        const rearUnitPos = { q: rearUnit.q, r: rearUnit.r, s: rearUnit.s };
        const knockbackResults = knockbackInfantryChain(
          rearUnitPos,
          source_cell,
          5,
          (pos) => {
            const unit = Array.from(this.state.units.values()).find(u =>
              u.q === pos.q && u.r === pos.r && u.s === pos.s
            );
            return unit ? { type: unit.type, id: unit.id, owner: unit.owner } : null;
          },
          (pos, excludeIds) => {
            return Array.from(this.state.units.values()).some(u =>
              !excludeIds.includes(u.id) &&
              u.q === pos.q && u.r === pos.r && u.s === pos.s
            );
          }
        );

        // 应用击退结果
        for (const result of knockbackResults) {
          const unit = this.state.units.get(result.id);
          if (!unit) continue;

          if (result.newPosition) {
            // 击退成功
            unit.q = result.newPosition.q;
            unit.r = result.newPosition.r;
            unit.s = result.newPosition.s;
            this.addBattleLog(`步兵被击退到(${result.newPosition.q}, ${result.newPosition.r}, ${result.newPosition.s})`);
          } else if (result.takeDamage) {
            // 被阻挡，受到1点伤害
            unit.hp -= 1;
            this.addBattleLog(`步兵无法击退，受到1点伤害`);

            if (unit.hp <= 0) {
              this.state.units.delete(unit.id);
              this.addBattleLog(`步兵阵亡！`);
            }
          }
        }

        // 限制前排机动
        target.movementRestricted = true;
        target.movementRestrictionSourceQ = source_cell.q;
        target.movementRestrictionSourceR = source_cell.r;
        target.movementRestrictionSourceS = source_cell.s;
        console.log(`[纵深抗击] 设置移动限制 - 单位ID: ${target.id}, 限制来源: (${source_cell.q}, ${source_cell.r}, ${source_cell.s})`);
        console.log(`[纵深抗击] 限制后状态 - movementRestricted: ${target.movementRestricted}, sourceQ: ${target.movementRestrictionSourceQ}`);
        this.addBattleLog(`前排步兵本回合被限制向敌方方向移动`);
      }
    }

    // === 计算伤害 ===
    //
    // 数值由 Rules.predictDamage 算（纵深抗击免伤、骑兵冲锋 +1、步兵护卫抵消加成）。
    // 和 buildValidActions 的 lethal 判断共用同一份实现 ——
    // 否则客户端画出来的「这一下能杀」会和实际结算对不上。
    // 这里只负责落值和写战报。
    const damage = Rules.predictDamage(
      attacker as unknown as Rules.UnitLike,
      target as unknown as Rules.UnitLike,
      this.unitList
    );
    if (attacker.type === 'cavalry' && attacker.moveDistance === 2) {
      const guarded = Rules.adjacentFriendlyInfantryCount(
        target as unknown as Rules.UnitLike, this.unitList
      ) >= 2;
      this.addBattleLog(guarded
        ? `步兵护卫：相邻己方步兵≥2，骑兵冲锋伤害+1无效`
        : `骑兵冲锋：伤害+1`);
    }
    if (damage > 0) {
      target.hp -= damage;
    }
    attacker.hasAttacked = true;
    attacker.actionsThisTurn = (attacker.actionsThisTurn || 0) + 1; // 增加行动次数

    // 骑兵攻击后清除冲锋距离（防止本回合重复获得加成）
    if (attacker.type === 'cavalry') {
      attacker.moveDistance = 0;
    }

    this.addBattleLog(`${role}的${attacker.type}攻击了${target.owner}的${target.type}，造成${damage}点伤害（消耗${actionCost}点行动值）`);

    // === 投石车溅射伤害 ===
    if (attacker.type === 'catapult') {
      const chargeLevel = attacker.chargeLevel || 0;

      // 投石车总是有溅射效果（常态或蓄力）
      const attackerPos = { q: attacker.q, r: attacker.r, s: attacker.s };
      const targetPos = { q: target.q, r: target.r, s: target.s };
      const splashHexes = getCatapultSplashTargets(attackerPos, targetPos, chargeLevel, 5);

      if (splashHexes.length > 0) {
        const splashType = chargeLevel === 0 ? "常态" : `蓄力${chargeLevel}层`;
        this.addBattleLog(`投石车${splashType}溅射效果触发！`);

        // 对每个溅射格子上的单位造成1点伤害
        for (const splashHex of splashHexes) {
          // 查找该格子上的单位
          const splashTarget = Array.from(this.state.units.values()).find(u =>
            u.q === splashHex.q && u.r === splashHex.r && u.s === splashHex.s
          );

          if (splashTarget) {
            // 造成1点溅射伤害
            splashTarget.hp -= 1;
            this.addBattleLog(`溅射伤害：${splashTarget.owner}的${splashTarget.type}受到1点伤害`);

            // 检查溅射目标是否被击杀
            if (splashTarget.hp <= 0) {
              // 骑兵特殊机制：掉马变成1血步兵
              if (splashTarget.type === "cavalry") {
                splashTarget.type = "infantry";
                splashTarget.maxHp = 2;
                splashTarget.hp = 1;
                this.addBattleLog(`${splashTarget.owner}的骑兵受溅射致命伤，掉马变成1血步兵！`);
              } else {
                // 其他单位直接击杀
                if (splashTarget.type === 'chariot') {
                  this.handleChariotDeath(splashTarget);
                }
                this.killUnit(splashTarget);
                this.addBattleLog(`溅射击杀：${splashTarget.owner}的${splashTarget.type}被击杀！`);

                // 处理首次击杀奖励
                this.grantFirstKillReward(role, splashTarget, '（溅射）');

                // 检查是否溅射击杀了将军
                if (splashTarget.type === "general") {
                  this.addBattleLog(`溅射击杀将军！${splashTarget.owner === "player1" ? "玩家1" : "玩家2"}下回合失去基础骰子`);
                }
              }
            }
          }
        }
      }

      // 攻击后消耗1层蓄力（不是清零）
      if (chargeLevel > 0) {
        attacker.chargeLevel = chargeLevel - 1;
        this.addBattleLog(`投石车蓄力层数：${chargeLevel} -> ${attacker.chargeLevel}`);
      }
    }

    // 骑兵特殊机制：骑兵的死亡等同于变成1血步兵
    if (target.type === "cavalry" && target.hp <= 0) {
      console.log(`[DEBUG] 骑兵死亡（hp=${target.hp}），掉马变成1血步兵`);
      target.type = "infantry";
      target.maxHp = 2;
      target.hp = 1; // 掉马后固定为1血步兵
      this.addBattleLog(`${target.owner}的骑兵受致命伤，掉马变成1血步兵！`);
    }

    // 检查是否击杀（骑兵已经在上面处理，这里只处理其他单位）
    if (target.hp <= 0) {
      // 检查是否是仁德阵营的击杀
      const rendeGeneral = Array.from(this.state.units.values()).find(u =>
        u.owner === role && u.type === "general" && u.generalType === "rende"
      );

      // 仁德阵营击杀非中立单位：发送确认请求给客户端
      // 力士排除在外：信仰不死已经规定它化为平民而不是阵亡，
      // 再让仁德选一次的话「转为中立标记」会造出一个**没有 civilian 标记**的
      // 中立单位，等于绕过了信仰不死。
      if (rendeGeneral && target.type !== 'neutral_marker' && target.type !== 'huangjin_lishi') {
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
      } else {
        // 非战车单位：直接击杀
        this.killUnit(target);
        this.addBattleLog(`${target.owner}的${target.type}被击杀！`);
      }

      // 如果击杀了中立标记，敌方仁德将军的转化费用重置
      // 公共平民是太平的机制，死了不该让仁德的招降费用回到 1 点
      // —— 两者都是 neutral_marker，靠 statusTag 区分（isCivilian）。
      if (target.type === "neutral_marker" && target.owner === "neutral"
          && !Rules.isCivilian(target as unknown as Rules.UnitLike)) {
        // 找到敌方的仁德将军
        const enemyRole = role === "player1" ? "player2" : "player1";
        const enemyRendeGeneral = Array.from(this.state.units.values()).find(u =>
          u.owner === enemyRole && u.type === "general" && u.generalType === "rende"
        );
        if (enemyRendeGeneral) {
          enemyRendeGeneral.convertInfantryCost = 1;
          this.addBattleLog(`击杀中立标记，${enemyRole === "player1" ? "玩家1" : "玩家2"}的转化费用重置为1点`);
        }
      }

      // 首次击杀奖励：立即获得额外骰子和行动点
      this.grantFirstKillReward(role, target);

      // 检查是否击杀了将军（失去基础骰子，下回合生效）
      if (target.type === "general") {
        this.addBattleLog(`${target.owner === "player1" ? "玩家1" : "玩家2"}的将军阵亡！下回合失去基础骰子`);
      }
    }
  }

  /**
   * 处理弩车贯穿攻击
   */
  private handleBallistaPierceAttack(client: Client, data: { ballistaId: string }) {
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
    } else {
      if (this.state.player2ActionPoints < 1) {
        client.send("error", { message: "行动点不足" });
        return;
      }
      this.state.player2ActionPoints -= 1;
    }

    // 作乱：非移动行动在效果生效前结算（已付 AP 不返还）
    if (this.applyZuoluan(ballista)) return;

    // 计算垂直贯穿路径
    const isPlayerOne = role === "player1";
    const shootingPath = this.getBallistaVerticalPath(ballista, isPlayerOne);

    // 找到路径上的所有单位
    const hitUnits: any[] = [];
    const hitUnitsIds = new Set<string>();

    shootingPath.forEach(hexPos => {
      const unit = Array.from(this.state.units.values()).find(u => {
        if (u.id === ballista.id || hitUnitsIds.has(u.id)) return false;

        // 检查是否是机关单位
        if (u.type === 'ballista' || u.type === 'chariot') {
          const machineType = u.type === 'ballista' ? 'ballista' : 'chariot';
          const occupiedHexes = getMachineOccupiedHexes({ q: u.q, r: u.r, s: u.s }, machineType);
          return occupiedHexes.some(hex => hexEquals(hex, hexPos));
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
      } else {
        this.state.player2ActionPoints += 1;
      }
      return;
    }

    console.log(`\n=== 弩车贯穿攻击调试 ===`);
    console.log(`弩车位置: (${ballista.q}, ${ballista.r}, ${ballista.s})`);
    console.log(`击中单位数: ${hitUnits.length}`);
    console.log(`第一个目标: (${hitUnits[0].q}, ${hitUnits[0].r}, ${hitUnits[0].s}) - ${hitUnits[0].type}`);
    console.log(`最后目标: (${hitUnits[hitUnits.length - 1].q}, ${hitUnits[hitUnits.length - 1].r}, ${hitUnits[hitUnits.length - 1].s}) - ${hitUnits[hitUnits.length - 1].type}`);
    console.log(`======================\n`);

    // === 第1步：结算最后一个目标的定身效果 ===
    const lastTarget = hitUnits[hitUnits.length - 1];
    lastTarget.cannotMoveNextTurn = true;
    lastTarget.cannotRotateNextTurn = true;
    console.log(`[定身] 设置定身效果 - 单位ID: ${lastTarget.id}, cannotMoveNextTurn: ${lastTarget.cannotMoveNextTurn}, cannotRotateNextTurn: ${lastTarget.cannotRotateNextTurn}`);
    this.addBattleLog(`${lastTarget.owner}的${lastTarget.type}被贯穿最后命中，定身1回合！`);

    // === 第2步：结算第一个目标的击退 ===
    const firstTarget = hitUnits[0];
    let firstTargetExtraDamage = 0;

    // 尝试击退第一个目标
    // 计算击退位置：沿着弩车贯穿方向继续前进一格
    // 玩家1正前方：(q+1, r-2, s+1)
    // 玩家2正前方：(q-1, r+2, s-1)
    const dq = isPlayerOne ? 1 : -1;
    const dr = isPlayerOne ? -2 : 2;
    const ds = isPlayerOne ? 1 : -1;

    const knockbackPos: HexCoord = {
      q: firstTarget.q + dq,
      r: firstTarget.r + dr,
      s: firstTarget.s + ds
    };

    // 检查击退位置是否有效（地图半径为5）
    const isKnockbackValid = isInMapRange(knockbackPos, 5);

    // 检查击退位置是否被占用
    const isKnockbackBlocked = isKnockbackValid && Array.from(this.state.units.values()).some(u => {
      if (u.id === firstTarget.id) return false;

      // 检查是否是机关单位
      if (u.type === 'ballista' || u.type === 'chariot') {
        const machineType = u.type === 'ballista' ? 'ballista' : 'chariot';
        const unitIsPlayerOne = u.owner === 'player1';
        const occupiedHexes = getMachineOccupiedHexes({ q: u.q, r: u.r, s: u.s }, machineType, unitIsPlayerOne);
        return occupiedHexes.some(hex => hexEquals(hex, knockbackPos));
      }

      // 普通单位只检查中心位置
      return u.q === knockbackPos.q && u.r === knockbackPos.r && u.s === knockbackPos.s;
    });

    console.log(`击退检查: 目标位置(${knockbackPos.q}, ${knockbackPos.r}, ${knockbackPos.s}), 有效=${isKnockbackValid}, 被阻挡=${isKnockbackBlocked}`);

    if (isKnockbackValid && !isKnockbackBlocked) {
      // 击退成功
      firstTarget.q = knockbackPos.q;
      firstTarget.r = knockbackPos.r;
      firstTarget.s = knockbackPos.s;
      this.addBattleLog(`${firstTarget.owner}的${firstTarget.type}被贯穿击退到(${knockbackPos.q}, ${knockbackPos.r}, ${knockbackPos.s})`);
    } else {
      // 击退失败，受到额外1点伤害
      firstTargetExtraDamage = 1;
      const reason = !isKnockbackValid ? "越界" : "被阻挡";
      this.addBattleLog(`${firstTarget.owner}的${firstTarget.type}无法被击退(${reason})，受到额外1点伤害`);
    }

    // === 第3步：对所有目标造成基础1点伤害 ===
    const unitsToDelete: string[] = [];

    hitUnits.forEach(target => {
      // 计算总伤害
      let totalDamage = 1;
      if (target.id === firstTarget.id) {
        totalDamage += firstTargetExtraDamage;
      }

      target.hp -= totalDamage;

      // 骑兵特殊机制：骑兵的死亡等同于变成1血步兵
      if (target.type === "cavalry" && target.hp <= 0) {
        target.type = "infantry";
        target.maxHp = 2;
        target.hp = 1;
        this.addBattleLog(`${target.owner}的骑兵被贯穿受致命伤，掉马变成1血步兵！`);
      }

      // 检查是否击杀（骑兵已经在上面处理）
      if (target.hp <= 0) {
        // 如果击杀的是战车，先生成2个不可行动的步兵，再删除战车
        if (target.type === 'chariot') {
          this.handleChariotDeath(target);
          unitsToDelete.push(target.id);
          this.addBattleLog(`${target.owner}的战车被弩车贯穿击杀，崩毁！`);
        } else {
          // 非战车单位：直接删除
          unitsToDelete.push(target.id);
          this.addBattleLog(`${target.owner}的${target.type}被弩车贯穿击杀！`);
        }

        // 如果击杀了将军，永久减少对方骰子数
        if (target.type === "general") {
          if (target.owner === "player1") {
            this.state.player1Dice = Math.max(0, this.state.player1Dice - 1);
            this.state.player1LostDice++;
          } else {
            this.state.player2Dice = Math.max(0, this.state.player2Dice - 1);
            this.state.player2LostDice++;
          }
          this.addBattleLog(`${target.owner}的将军被击杀，永久失去1颗骰子！`);
        }

        // 首次击杀奖励（只对敌方单位）
        if (target.owner !== role) {
          this.grantFirstKillReward(role, target);
        }
      } else {
        if (totalDamage > 1) {
          this.addBattleLog(`${target.owner}的${target.type}被弩车贯穿，共受到${totalDamage}点伤害`);
        } else {
          this.addBattleLog(`${target.owner}的${target.type}被弩车贯穿，受到1点伤害`);
        }
      }
    });

    // 删除所有被击杀的单位
    unitsToDelete.forEach(id => {
      const dead = this.state.units.get(id);
      if (dead) this.killUnit(dead);
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
  private handleBallistaMeleeAttack(client: Client, data: { ballistaId: string, targetId: string }) {
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
    // 相邻 / 敌我判定。
    // 这里原来什么都不查，扣掉行动点就直接扣血，等于弩车能近战全图任何单位
    // （范围规则只存在于客户端高亮里）。改为与 getAttackableTargets 共用同一谓词。
    const melee = this.checkBallistaMeleeLegality(ballista, target);
    if (!melee.ok) {
      client.send("error", { message: melee.reason });
      return;
    }

    // 检查行动点
    if (role === "player1") {
      if (this.state.player1ActionPoints < 1) {
        client.send("error", { message: "行动点不足" });
        return;
      }
      this.state.player1ActionPoints -= 1;
    } else {
      if (this.state.player2ActionPoints < 1) {
        client.send("error", { message: "行动点不足" });
        return;
      }
      this.state.player2ActionPoints -= 1;
    }

    // 作乱：非移动行动在效果生效前结算（已付 AP 不返还）
    if (this.applyZuoluan(ballista)) return;

    // 弩车近战攻击造成1点伤害
    target.hp -= 1;
    ballista.hasActedThisTurn = true;
    ballista.hasAttacked = true;
    ballista.actionsThisTurn = (ballista.actionsThisTurn || 0) + 1;

    this.addBattleLog(`${role === "player1" ? "玩家1" : "玩家2"}的弩车近战攻击${target.owner}的${target.type}，造成1点伤害`);

    // 骑兵特殊机制：骑兵的死亡等同于变成1血步兵
    if (target.type === "cavalry" && target.hp <= 0) {
      target.type = "infantry";
      target.maxHp = 2;
      target.hp = 1;
      this.addBattleLog(`${target.owner}的骑兵受致命伤，掉马变成1血步兵！`);
    }

    // 检查是否击杀（骑兵已经在上面处理）
    if (target.hp <= 0) {
      // 如果击杀的是战车，先生成2个不可行动的步兵，再删除战车
      if (target.type === 'chariot') {
        this.handleChariotDeath(target);
        this.state.units.delete(data.targetId);
        this.addBattleLog(`${target.owner}的战车被弩车近战击杀，崩毁！`);
      } else {
        // 非战车单位：直接删除
        this.killUnit(target);
        this.addBattleLog(`${target.owner}的${target.type}被弩车近战击杀！`);
      }

      // 如果击杀了将军，永久减少对方骰子数
      if (target.type === "general") {
        if (target.owner === "player1") {
          this.state.player1Dice = Math.max(0, this.state.player1Dice - 1);
          this.state.player1LostDice++;
        } else {
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
        this.grantFirstKillReward(role, target);
      }
    } else {
      // 目标受伤但未击杀
    }

    client.send("info", { message: "近战攻击成功" });
  }

  /**
   * 处理投石车蓄力
   */
  private handleCatapultCharge(client: Client, data: { catapultId: string }) {
    const role = this.getPlayerRole(client);
    if (!role) return;

    // 验证是否是当前玩家
    if (role !== this.state.currentPlayer) {
      client.send("error", { message: "不是你的回合" });
      return;
    }

    // 验证阶段（只能在行动阶段蓄力）
    if (this.state.phase !== "action") {
      client.send("error", { message: "当前阶段不能蓄力" });
      return;
    }

    // 查找投石车
    const catapult = this.state.units.get(data.catapultId);
    if (!catapult) {
      client.send("error", { message: "投石车不存在" });
      return;
    }

    // 验证单位类型
    if (catapult.type !== 'catapult') {
      client.send("error", { message: "该单位不是投石车" });
      return;
    }

    // 验证所有权
    if (catapult.owner !== role) {
      client.send("error", { message: "这不是你的投石车" });
      return;
    }

    // 验证行动次数（每回合最多2次）
    if ((catapult.actionsThisTurn || 0) >= 2) {
      client.send("error", { message: "投石车本回合已达行动次数上限（2次）" });
      return;
    }

    // 验证蓄力层数（最多2层）
    const currentCharge = catapult.chargeLevel || 0;
    if (currentCharge >= 2) {
      client.send("error", { message: "投石车已达到最大蓄力层数" });
      return;
    }

    // 检查行动点是否足够（蓄力消耗1点行动点）
    const currentActionPoints = role === "player1"
      ? this.state.player1ActionPoints
      : this.state.player2ActionPoints;

    if (currentActionPoints < 1) {
      client.send("error", { message: "行动点不足" });
      return;
    }

    // 作乱：非移动行动在效果生效前结算（已付 AP 不返还）
    if (this.applyZuoluan(catapult)) return;

    // 执行蓄力
    catapult.chargeLevel = currentCharge + 1;
    catapult.hasActedThisTurn = true;
    catapult.actionsThisTurn = (catapult.actionsThisTurn || 0) + 1;

    // 消耗行动点
    if (role === "player1") {
      this.state.player1ActionPoints -= 1;
    } else {
      this.state.player2ActionPoints -= 1;
    }

    this.addBattleLog(`${role === "player1" ? "玩家1" : "玩家2"}的投石车蓄力成功，当前层数：${catapult.chargeLevel}/2`);
    client.send("info", { message: `投石车蓄力成功 (${catapult.chargeLevel}/2)` });

    console.log(`[DEBUG] 投石车蓄力 - catapultId: ${data.catapultId}, chargeLevel: ${catapult.chargeLevel}`);
  }

  /** 弩车垂直贯穿路径。规则实现见 shared/rules/queries.ts */
  private getBallistaVerticalPath(ballista: any, isPlayerOne: boolean): HexCoord[] {
    return Rules.getBallistaVerticalPath(ballista, isPlayerOne);
  }

  /**
   * 处理旋转单位（弓箭手朝向）
   */
  private handleRotateUnit(client: Client, data: { unitId: string, direction: number }) {
    const role = this.getPlayerRole(client);
    if (!role || role !== this.state.currentPlayer) return;

    const unit = this.state.units.get(data.unitId);
    if (!unit || !this.canCommandUnit(unit, role)) return;

    // 检查是否被定身（无法旋转）
    if (unit.cannotRotateNextTurn) {
      client.send("error", { message: "该单位被定身，无法旋转" });
      return;
    }

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
    } else {
      if (this.state.player2ActionPoints < 1) {
        client.send("error", { message: "行动点不足" });
        return;
      }
      this.state.player2ActionPoints -= 1;
    }

    // 作乱：非移动行动在效果生效前结算（已付 AP 不返还）
    if (this.applyZuoluan(unit)) return;

    unit.direction = data.direction;
    unit.hasRotated = true; // 标记已转向
    unit.actionsThisTurn = (unit.actionsThisTurn || 0) + 1; // 增加行动次数
    this.addBattleLog(`${role}旋转${unit.type}朝向（消耗1点行动值）`);
  }

  /**
   * 处理结束回合
   */
  private handleEndTurn(client: Client) {
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
        const results: number[] = [];
        for (let i = 0; i < diceCount; i++) {
          results.push(this.rollD6());
        }

        const totalPoints = results.reduce((sum, val) => sum + val, 0);
        this.state.player2Dice = diceCount;
        this.state.player2DiceResults.clear();
        results.forEach(r => this.state.player2DiceResults.push(r));
        this.state.player2ActionPoints = totalPoints;

        this.addBattleLog(`玩家2投骰子：${diceCount}颗骰子（基础1+玩家1部署${deployedValue.toFixed(1)}元），点数${results.join(',')}，共${totalPoints}点行动值`);
        return;
      } else {
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
          if (unit.type === "ballista" || unit.type === "chariot" || unit.type === "catapult") {
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
    //
    // 太平的结算放在最前面（§7.1 第 5-7 步：夺天命 → 天命难承 → 胜利判定）。
    // 放前面是因为它可能**中止**本次回合结束：太平若死于天命难承，
    // §7.1 末尾要求立刻执行一次黄巾腐化，而腐化要玩家选目标。
    // 如果把它放在重置标记之后，中止再重来就会把「上回合是否击杀」这类
    // 一次性状态刷掉两遍。
    this.settleDestiny(role);

    if (this.taipingOf(role).pendingCorrupt.length > 0) {
      this.addBattleLog(`太平倒下，黄巾立刻转向百姓 —— 完成腐化后再结束回合`);
      client.send("info", { message: "请先完成强制腐化，再结束回合" });
      return;
    }

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

        // 重置所有单位的已行动状态（含散架步兵等非机关单位）
        unit.hasActedThisTurn = false;

        // 清除定身效果（回合结束时清除）
        if (unit.cannotMoveNextTurn || unit.cannotRotateNextTurn) {
          console.log(`[定身] 清除定身效果 - 单位ID: ${unit.id}, 之前状态: cannotMove=${unit.cannotMoveNextTurn}, cannotRotate=${unit.cannotRotateNextTurn}`);
          this.addBattleLog(`${unit.owner}的${unit.type}定身效果解除`);
          unit.cannotMoveNextTurn = false;
          unit.cannotRotateNextTurn = false;
        }

        // 清除步兵纵深抗击的移动限制（回合结束时清除）
        if (unit.movementRestricted) {
          console.log(`[纵深抗击] 清除移动限制 - 单位ID: ${unit.id}, 类型: ${unit.type}`);
          this.addBattleLog(`${unit.owner}的步兵移动限制解除`);
          unit.movementRestricted = false;
          unit.movementRestrictionSourceQ = 0;
          unit.movementRestrictionSourceR = 0;
          unit.movementRestrictionSourceS = 0;
        }

        // 清除骑兵移动距离记录（回合结束时清除）
        if (unit.moveDistance > 0) {
          unit.moveDistance = 0;
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
    } else {
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
    } else {
      this.state.currentPlayer = "player1";
      this.state.turn++;
      // 新的完整轮次开始：平民之死的扣天命额度（每轮 2 点）重置。
      // 额度以 turn 为单位，所以 player1 回合和 player2 回合共用这 2 点。
      this.state.player1Taiping.destinyLostThisRound = 0;
      this.state.player2Taiping.destinyLostThisRound = 0;
      this.addBattleLog(`--- 第${this.state.turn}回合 - 玩家1 ---`);
      // 自动为玩家1投骰子
      this.rollDiceForPlayer("player1");
    }

    this.broadcast("turnChange", { currentPlayer: this.state.currentPlayer });
  }

  /**
   * 辅助函数：获取将领中文名
   */
  private getGeneralName(type: string): string {
    const names: Record<string, string> = {
      wushuang: "无双",
      shenji: "神机",
      rende: "仁德",
      taiping: "太平",
    };
    return names[type] || type;
  }

  // ========================================
  // 无双将军扇形攻击处理器
  // ========================================

  /**
   * 处理开始扇形攻击
   */
  private handleWushuangFanAttackStart(client: Client) {
    const role = this.getPlayerRole(client);
    if (!role || role !== this.state.currentPlayer) {
      client.send("error", { message: "不是你的回合" });
      return;
    }

    // 查找无双将军
    const general = Array.from(this.state.units.values()).find(u =>
      u.owner === role && u.type === "general" && u.generalType === "wushuang"
    );

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
  private handleWushuangSelectDirection(client: Client, data: { direction: number }) {
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
  private handleWushuangExecuteAttack(client: Client) {
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
    const general = Array.from(this.state.units.values()).find(u =>
      u.owner === role && u.type === "general" && u.generalType === "wushuang"
    );

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
      } else {
        this.state.player2ActionPoints -= 3;
      }

      // 进入第二阶段
      this.state.wushuangAttackPhase = "second-roll";
      this.state.wushuangSelectedDirection = -1; // 重置方向
      this.addBattleLog("第一次攻击完成，是否消耗2点行动值继续掷骰？");

    } else if (this.state.wushuangAttackPhase === "second-attack") {
      // 第二次攻击
      this.performFanAttack(general, role, this.state.wushuangSelectedDirection);

      // 进入第三阶段
      this.state.wushuangAttackPhase = "third-roll";
      this.state.wushuangSelectedDirection = -1;
      this.addBattleLog("第二次攻击完成，进入第三阶段");

    } else if (this.state.wushuangAttackPhase === "third-attack") {
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
  private handleWushuangSecondRoll(client: Client) {
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
    } else {
      this.state.player2ActionPoints -= 2;
    }

    // 掷骰子
    const roll = this.rollD6();
    this.state.wushuangDiceRolls.push(roll);
    this.addBattleLog(`第二阶段掷骰结果：${roll}`);

    if (roll <= 2) {
      // 掷出1或2，可以进行第二次攻击
      this.addBattleLog(`掷出${roll}！可以进行第二次攻击，请选择方向`);
      this.state.wushuangAttackPhase = "second-attack";
      this.state.wushuangSelectedDirection = -1; // 重置方向，让玩家重新选择
    } else {
      // 掷出3-6，第二次攻击未触发，但保持在 second-roll 阶段让玩家看到结果
      this.addBattleLog(`掷出${roll}，第二次攻击未触发，点击"结束"按钮完成扇形攻击`);
      // 不调用 resetWushuangFanAttack()，让玩家可以看到结果并手动点击"结束"
    }
  }

  /**
   * 处理第三阶段掷骰
   */
  private handleWushuangThirdRoll(client: Client) {
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
    } else {
      this.state.player2ActionPoints -= 1;
    }

    // 掷骰子
    const roll = this.rollD6();
    this.state.wushuangDiceRolls.push(roll);
    this.addBattleLog(`第三阶段掷骰结果：${roll}`);

    if (roll === 1) {
      // 掷出1，可以进行第三次攻击
      this.addBattleLog("掷出1！可以进行第三次攻击，请选择方向");
      this.state.wushuangAttackPhase = "third-attack";
      this.state.wushuangSelectedDirection = -1; // 重置方向，让玩家重新选择
    } else {
      // 掷出2-6，第三次攻击未触发，但保持在 third-roll 阶段让玩家看到结果
      this.addBattleLog(`掷出${roll}，第三次攻击未触发，点击"结束"按钮完成扇形攻击`);
      // 不调用 resetWushuangFanAttack()，让玩家可以看到结果并手动点击"结束"
    }
  }

  /**
   * 处理取消扇形攻击
   */
  private handleWushuangCancel(client: Client) {
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
  private performFanAttack(general: UnitSchema, attacker: "player1" | "player2", direction: number) {
    // 作乱：扇形攻击分三段，拦在这里一处覆盖全部三段
    if (this.applyZuoluan(general)) return;

    // 获取扇形区域（120度，覆盖3个单位）
    const fanHexes = getFanShapedHexes(
      { q: general.q, r: general.r, s: general.s },
      direction,
      3,
      5
    );

    // 找到扇形区域内的所有敌方单位
    const enemyUnits = Array.from(this.state.units.values()).filter(u => {
      if (u.owner === attacker) return false;
      return fanHexes.some(hex => hexEquals(hex, { q: u.q, r: u.r, s: u.s }));
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
        this.killUnit(target);
        this.addBattleLog(`扇形攻击击杀了${target.type}！`);

        // 记录击杀
        this.grantFirstKillReward(attacker, target);

        // 如果击杀了将军，减少骰子
        if (target.type === "general") {
          this.addBattleLog(`${target.owner === "player1" ? "玩家1" : "玩家2"}的将军阵亡！下回合失去基础骰子`);
        }
      } else {
        // 造成伤害
        target.hp = newHp;
        this.addBattleLog(`扇形攻击命中${target.type}`);
      }
    });
  }

  /**
   * 重置扇形攻击状态
   */
  private resetWushuangFanAttack() {
    this.state.wushuangFanAttackActive = false;
    this.state.wushuangAttackingPlayer = "";
    this.state.wushuangAttackPhase = "";
    this.state.wushuangSelectedDirection = -1;
    this.state.wushuangDiceRolls.clear();
  }

  /**
   * 获取方向名称
   */
  private getDirectionName(direction: number): string {
    const names: Record<number, string> = {
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
  private handleWushuangAbility(client: Client) {
    const role = this.getPlayerRole(client);
    if (!role || role !== this.state.currentPlayer) {
      client.send("error", { message: "不是你的回合" });
      return;
    }

    // 查找无双将军
    const general = Array.from(this.state.units.values()).find(u =>
      u.owner === role && u.type === "general" && u.generalType === "wushuang"
    );

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
    general.unlimitedActions = true;   // 解除移动和攻击次数限制
    general.abilityUsed = true;        // 标记技能已使用

    const newLimit = 2 + lostHp;
    if (lostHp > 0) {
      this.addBattleLog(`${role === "player1" ? "玩家1" : "玩家2"}使用无双技能：行动次数上限 2 → ${newLimit}，已损失${lostHp}点体力`);
      this.addBattleLog("本回合移动和扇形攻击次数限制解除！");
      client.send("info", { message: `技能生效！行动次数上限增加${lostHp}次，移动和攻击次数限制解除` });
    } else {
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
  private handleShenjiDeployMachine(client: Client, data: { machineType: 'ballista' | 'chariot'; position: { q: number; r: number; s: number } }) {
    const role = this.getPlayerRole(client);
    if (!role || role !== this.state.currentPlayer) {
      client.send("error", { message: "不是你的回合" });
      return;
    }

    // 查找神机将军
    const general = Array.from(this.state.units.values()).find(u =>
      u.owner === role && u.type === "general" && u.generalType === "shenji"
    );

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
    // 战车需要：4步兵
    const totalInfantryStock = role === 'player1' ? this.state.player1Infantry : this.state.player2Infantry;
    const totalArcherStock = role === 'player1' ? this.state.player1Archer : this.state.player2Archer;
    const consumedInfantry = role === 'player1' ? this.state.player1ConsumedInfantry : this.state.player2ConsumedInfantry;
    const consumedArcher = role === 'player1' ? this.state.player1ConsumedArcher : this.state.player2ConsumedArcher;

    // 计算剩余可用库存
    const availableInfantry = totalInfantryStock - consumedInfantry;
    const availableArcher = totalArcherStock - consumedArcher;

    if (data.machineType === 'ballista') {
      if (availableInfantry < 4 || availableArcher < 1) {
        client.send("error", { message: `兵力库存不足：部署弩车需要4步兵+1弓箭手（剩余：${availableInfantry}步兵，${availableArcher}弓箭手）` });
        return;
      }
    } else if (data.machineType === 'chariot') {
      if (availableInfantry < 4) {
        client.send("error", { message: `兵力库存不足：部署战车需要4步兵（剩余：${availableInfantry}步兵）` });
        return;
      }
    }

    // 检查位置是否在地图范围内且所有占用格子都没有被占用
    const MAP_RADIUS = 5;
    const isPlayerOne = role === 'player1';
    const occupiedHexes = getMachineOccupiedHexes(data.position, data.machineType, isPlayerOne);

    // 检查所有占用格子是否在地图范围内
    const allInRange = occupiedHexes.every(hex => isInMapRange(hex, MAP_RADIUS));
    if (!allInRange) {
      client.send("error", { message: "机关单位超出地图边界" });
      return;
    }

    // 检查所有占用格子是否都没有被占用（包括其他机关单位占据的格子）
    const hasCollision = occupiedHexes.some(hex => {
      // 检查是否有单位在这个格子
      const hasUnit = Array.from(this.state.units.values()).some(u =>
        u.q === hex.q && u.r === hex.r && u.s === hex.s
      );
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
    const machine = new UnitSchema();
    machine.id = this.newUnitId(data.machineType);
    machine.type = data.machineType;
    machine.owner = role;
    machine.q = data.position.q;
    machine.r = data.position.r;
    machine.s = data.position.s;
    // 弩车方向指向对方：player1的弩车指向北(6)，player2的弩车指向南(7)
    // 战车方向无意义，设为0
    // 弩车和战车血量都是4
    if (data.machineType === 'ballista') {
      machine.direction = role === 'player1' ? 6 : 7;  // NORTH : SOUTH
    } else {
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
      } else {
        this.state.player2ConsumedInfantry += 4;
        this.state.player2ConsumedArcher += 1;
      }
    } else if (data.machineType === 'chariot') {
      // 战车：消耗4步兵库存
      if (role === 'player1') {
        this.state.player1ConsumedInfantry += 4;
      } else {
        this.state.player2ConsumedInfantry += 4;
      }
    }

    // 消耗行动点
    if (role === "player1") {
      this.state.player1ActionPoints -= requiredPoints;
    } else {
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
    } else {
      this.state.player2DeployedValue += machineValue;
    }
  }

  /**
   * 处理神机将军改骰技能
   */
  private handleShenjiModifyDice(client: Client, data: { diceIndex: number; newValue: number }) {
    const role = this.getPlayerRole(client);
    if (!role || role !== this.state.currentPlayer) {
      client.send("error", { message: "不是你的回合" });
      return;
    }

    // 查找神机将军
    const general = Array.from(this.state.units.values()).find(u =>
      u.owner === role && u.type === "general" && u.generalType === "shenji"
    );

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
    } else {
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
  private handleRendeConvertAdjacent(client: Client) {
    const role = this.getPlayerRole(client);
    if (!role || role !== this.state.currentPlayer) {
      client.send("error", { message: "不是你的回合" });
      return;
    }

    // 查找仁德将军
    const general = Array.from(this.state.units.values()).find(u =>
      u.owner === role && u.type === "general" && u.generalType === "rende"
    );

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
    const neighbors = hexRange(generalPos, 1).filter(hex => !hexEquals(hex, generalPos));

    // 找到所有相邻的敌方单位
    const adjacentEnemies = Array.from(this.state.units.values()).filter(u => {
      if (u.owner === role || u.id === general.id) return false;

      // 检查是否是机关单位
      if (u.type === 'ballista' || u.type === 'chariot' || u.type === 'catapult') {
        const machineType = u.type === 'ballista' ? 'ballista' : u.type === 'catapult' ? 'catapult' : 'chariot';
        const isPlayerOne = u.owner === 'player1';
        const occupiedHexes = getMachineOccupiedHexes({ q: u.q, r: u.r, s: u.s }, machineType, isPlayerOne);
        return occupiedHexes.some(hex =>
          neighbors.some(neighbor => hexEquals(neighbor, hex))
        );
      }

      // 普通单位
      return neighbors.some(hex => hexEquals(hex, { q: u.q, r: u.r, s: u.s }));
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

      // 机关单位需要翻转方向（因为它们��是中心对称的）
      if (enemy.type === 'ballista' || enemy.type === 'catapult') {
        // 弩车和投石车的朝向需要翻转
        // player1的机关朝北（敌人在北），player2的机关朝南（敌人在南）
        enemy.direction = role === 'player1' ? 6 : 7;  // NORTH : SOUTH
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
  private handleRendeConvertToInfantry(client: Client, data: { targetId: string }) {
    const role = this.getPlayerRole(client);
    if (!role || role !== this.state.currentPlayer) {
      client.send("error", { message: "不是你的回合" });
      return;
    }

    // 查找仁德将军
    const general = Array.from(this.state.units.values()).find(u =>
      u.owner === role && u.type === "general" && u.generalType === "rende"
    );

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
    } else {
      this.state.player2ActionPoints -= currentCost;
    }

    // 创建步兵（血量为1）
    const infantry = new UnitSchema();
    infantry.id = this.newUnitId('infantry');
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
  private handleRendeCompleteKill(client: Client, data: { targetId: string }) {
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
    this.killUnit(target);
    this.addBattleLog(`${role === "player1" ? "玩家1" : "玩家2"}击杀了${target.owner}的${target.type}`);

    // 首次击杀奖励
    this.grantFirstKillReward(role, target);

    // 如果击杀了将军
    if (target.type === "general") {
      this.addBattleLog(`${target.owner === "player1" ? "玩家1" : "玩家2"}的将军阵亡！下回合失去基础骰子`);
    }

    // 如果击杀了中立标记，重置转化费用（公共平民除外，同上）
    if (target.type === "neutral_marker" && target.owner === "neutral"
        && !Rules.isCivilian(target as unknown as Rules.UnitLike)) {
      const rendeGeneral = Array.from(this.state.units.values()).find(u =>
        u.owner === role && u.type === "general" && u.generalType === "rende"
      );
      if (rendeGeneral) {
        rendeGeneral.convertInfantryCost = 1;
        this.addBattleLog(`击杀中立标记，转化费用重置为1点`);
      }
    }

    // 如果击杀了弩车，检查是否贯穿过2个以上目标，如果是则给神机将军拥有者重投机会
    if (target.type === "ballista") {
      const targetOwner = target.owner;
      const shenjiGeneral = Array.from(this.state.units.values()).find(u =>
        u.owner === targetOwner && u.type === "general" && u.generalType === "shenji"
      );
      // 只有当弩车生前贯穿过2个以上目标时，才给重投机会
      if (shenjiGeneral && target.pierceCount >= 2) {
        if (targetOwner === "player1") {
          this.state.player1RerollTokens++;
          this.addBattleLog(`玩家1的弩车被击毁（生前贯穿${target.pierceCount}个目标），获得1次重投机会`);
        } else {
          this.state.player2RerollTokens++;
          this.addBattleLog(`玩家2的弩车被击毁（生前贯穿${target.pierceCount}个目标），获得1次重投机会`);
        }
      } else if (shenjiGeneral) {
        this.addBattleLog(`${targetOwner === "player1" ? "玩家1" : "玩家2"}的弩车被击毁（仅贯穿${target.pierceCount}个目标，未达到2个），无重投奖励`);
      }
    }

    // 注意：战车的处理已经在前面完成，这里不需要再处理

    client.send("info", { message: "击杀完成" });
  }

  /**
   * 处理仁德将军击杀确认：转为中立标记
   */
  private handleRendeSpareAsNeutral(client: Client, data: { targetId: string }) {
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
      const occupiedHexes = getMachineOccupiedHexes({ q: target.q, r: target.r, s: target.s }, machineType);
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
    } else {
      this.state.player2ActionPoints -= requiredActionPoints;
    }

    // 检查是否是机关单位
    if (target.type === 'ballista' || target.type === 'chariot') {
      // 机关单位：在所有占用的格子上分别创建中立标记
      const machineType = target.type === 'ballista' ? 'ballista' : 'chariot';
      const occupiedHexes = getMachineOccupiedHexes({ q: target.q, r: target.r, s: target.s }, machineType);

      occupiedHexes.forEach((hex, index) => {
        const neutral = new UnitSchema();
        neutral.id = this.newUnitId('neutral');
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
    } else {
      // 普通单位：创建单个中立标记
      const neutral = new UnitSchema();
      neutral.id = this.newUnitId('neutral');
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

  /** 判断当前玩家是否可以指挥某单位 */
  private canCommandUnit(unit: UnitSchema, role: "player1" | "player2"): boolean {
    return unit.owner === role;
  }

  /**
   * 首次击杀奖励（士气）：当回合第一次击杀时立刻多投一颗骰子，点数直接进行动值。
   *
   * 原来这段在 7 处各复制了一遍（普通攻击、战车碾压、投石车溅射、弩车贯穿、
   * 弩车近战、无双扇形、仁德确认击杀）。收成一个方法是因为
   * 「哪些击杀不算战功」需要一处统一判断 —— 击杀公共平民就是第一个这样的例外，
   * 否则这条规则得在 7 个地方各写一遍。
   *
   * 注意各调用点原有的额外前置条件（战车碾压只对敌方单位计功）保持不变，
   * 那是既有行为，不在本次改动范围内。
   */
  private grantFirstKillReward(
    role: "player1" | "player2",
    victim: UnitSchema,
    label = ''
  ): boolean {
    // 击杀公共平民不算战功 —— 这条规则只在这一处判断，
    // 这正是把 7 份复制收成一个方法的原因。
    if (Rules.isCivilian(victim as unknown as Rules.UnitLike)) {
      this.addBattleLog(`击杀平民不计战功，无士气奖励`);
      return false;
    }
    if (victim.type === "huangjin_lishi") {
      this.addBattleLog(`黄巾力士信仰不死，化为平民而非阵亡，无士气奖励`);
      return false;
    }

    const already = role === "player1"
      ? this.state.player1KilledThisTurn
      : this.state.player2KilledThisTurn;
    if (already) return false;

    const extraRoll = this.rollD6();
    if (role === "player1") {
      this.state.player1KilledThisTurn = true;
      this.state.player1KillDice++;
      this.state.player1Dice++;
      this.state.player1DiceResults.push(extraRoll);
      this.state.player1ActionPoints += extraRoll;
    } else {
      this.state.player2KilledThisTurn = true;
      this.state.player2KillDice++;
      this.state.player2Dice++;
      this.state.player2DiceResults.push(extraRoll);
      this.state.player2ActionPoints += extraRoll;
    }
    this.addBattleLog(
      `${role === "player1" ? "玩家1" : "玩家2"}首次击杀${label}！获得额外骰子，投出${extraRoll}点`
    );
    return true;
  }

  /**
   * 真正的「阵亡」出口：移除单位并结算死亡的连带效果。
   *
   * 和裸的 `units.delete` 的分工：**死亡走这里，转化不走**。
   * 仁德招降中立单位、以德服人转中立、力士被击败转平民都是转化，
   * 它们会删掉原单位再造一个，但不该触发死亡效果（比如扣太平天命）。
   */
  private killUnit(unit: UnitSchema): void {
    // 黄巾力士不会真的死 —— 信仰不死：体力耗尽时化为 1 血中立平民。
    // 拦在这里而不是在每条伤害路径上，是因为所有真正的死亡都经过这个出口。
    if (unit.type === "huangjin_lishi") {
      this.convertLishiToCivilian(unit);
      return;
    }

    const wasCivilian = Rules.isCivilian(unit as unknown as Rules.UnitLike);
    const wasTaiping = unit.type === "general" && unit.generalType === "taiping";
    const owner = unit.owner as "player1" | "player2";

    // 先下场再结算，这样连带效果里的 isTaipingAlive 看到的是事后的局面
    this.state.units.delete(unit.id);

    if (wasCivilian) this.onCivilianKilled(unit);
    if (wasTaiping) this.onTaipingGeneralDeath(owner);
  }

  /**
   * 太平将军阵亡 —— 从「黄天未立」转入「苍天已死」。
   *
   * 所有真正的死亡路径都经过 killUnit，所以这个钩子不会被漏掉：
   * 被攻击打死、被机关打死、被天命难承压死，走的都是同一个出口。
   */
  private onTaipingGeneralDeath(role: "player1" | "player2"): void {
    const who = role === "player1" ? "玩家1" : "玩家2";
    this.addBattleLog(`⚡ ${who}的太平阵亡 —— 苍天已死，黄巾失去信仰`);

    // 黄天当立随将领一起没了，而且是**永久**失去：
    // handleTaipingDeclareHuangtian 要求太平在场，所以之后再也宣告不了。
    const tp = this.taipingOf(role);
    if (tp.huangtianDeclaredTurn >= 0) {
      tp.huangtianDeclaredTurn = -1;
      this.addBattleLog(`${who}的黄天当立宣告随太平阵亡而作废`);
      this.broadcast("huangtianCancelled", { by: role, reason: "太平阵亡" });
    }

    // 还没来得及征募的平民不再是义务 —— 豆饭是太平的被动，人没了就没了
    if (tp.pendingRecruit.length > 0) {
      this.addBattleLog(`${who}的豆饭征募随太平阵亡而中止（${tp.pendingRecruit.length} 名平民获免）`);
      tp.pendingRecruit.clear();
    }

    this.applyQiyi(role);
    // 起义（力士→贼）与随之而来的腐化在步骤 9 / 11 接进来
  }

  /**
   * 平民阵亡：每名**仍然存活**的太平失去 1 点天命，每个完整轮次最多 2 点。
   *
   * 「完整轮次」以 `state.turn` 为单位（turn 在切回 player1 时 ++），
   * 所以 player1 回合和 player2 回合共用这 2 点额度。
   *
   * 额度记的是**真的扣掉的点数**：天命已经见底（0）时扣不动，
   * 也就不占用本轮额度 —— 否则「天命 0 时死两个平民」会白白吃掉额度，
   * 让之后天命涨回来的那一刻反而免疫。
   *
   * 力士被击败转化来的平民不算平民死亡，走的是转化路径，不到这里。
   */
  private onCivilianKilled(civ: UnitSchema): void {
    for (const role of ["player1", "player2"] as const) {
      if (!this.isTaipingAlive(role)) continue;
      const tp = this.taipingOf(role);
      const who = role === "player1" ? "玩家1" : "玩家2";

      if (tp.destiny <= 0) continue; // 已见底，扣不动也不占额度

      if (tp.destinyLostThisRound >= 2) {
        this.addBattleLog(`${who}的太平本轮已因平民之死失去 2 点天命，${civ.id} 不再扣减`);
        continue;
      }

      tp.destinyLostThisRound++;
      const before = tp.destiny;
      tp.destiny -= 1;
      this.addBattleLog(`平民${civ.id}身死，${who}的太平天命 ${before}→${tp.destiny}`);
    }
  }

  /**
   * 作乱结算：行动单位若与充能黄巾贼相邻，立刻受 1 点系统伤害。
   *
   * 四条容易写错的细节：
   *   - **无论相邻多少贼，同一次行动最多 1 点**（旧实现是「相邻贼数量」点，正相反）
   *   - 所有相邻且充满的贼**同时**耗尽充能，不是只耗掉一个
   *   - 伤害来源是系统：不给击杀士气奖励，也不需要支付攻击将领的额外 AP
   *   - 不分敌我，只有「贼对贼」豁免
   *
   * @returns true = 行动单位已被作乱打死，调用方必须立刻中止后续效果
   */
  private applyZuoluan(unit: UnitSchema): boolean {
    if (!this.state.units.has(unit.id)) return true;
    if (this.state.phase === "end") return false;

    const sources = Rules.getZuoluanSources(
      unit as unknown as Rules.UnitLike,
      this.unitList
    ) as unknown as UnitSchema[];
    if (sources.length === 0) return false;

    // 相邻的充能贼全部耗尽 —— 一次行动把周围一片贼的威慑同时用掉，
    // 这是贼「传播暴乱会暂时降低自身威慑」的机制来源
    for (const z of sources) {
      const live = this.state.units.get(z.id);
      if (live) live.charged = false;
    }

    unit.hp -= 1;
    this.addBattleLog(
      `作乱！${unit.id} 在 ${sources.length} 名充能黄巾贼旁行动，受到 1 点系统伤害`
      + `（体力 ${unit.hp + 1}→${unit.hp}，${sources.length} 名贼充能耗尽）`
    );

    if (unit.hp > 0) return false;

    // 系统伤害：不走 grantFirstKillReward，所以不会给任何人士气奖励
    this.killUnit(unit);
    this.addBattleLog(`${unit.id} 死于作乱（系统伤害，无士气奖励）`);
    return true;
  }

  /**
   * 起义：太平阵亡的瞬间，该方所有黄巾力士转化为黄巾贼。
   *
   * 继承转化前的剩余体力（1 血力士变成 1 血贼），并立即获得**充满**的作乱充能
   * —— 所以太平倒下那一刻，整片黄巾同时变成会反伤的威胁，
   * 这是「苍天已死」阶段最主要的补偿。
   *
   * 原地改 type 而不是删掉重建：贼继承体力和位置，id 不变也让战报里
   * 「lishi3 变成黄巾贼」这件事可追。和力士转平民不同 —— 那边是换阵营，
   * 新 id 才说得清。
   */
  private applyQiyi(role: "player1" | "player2"): void {
    const lishiList = Array.from(this.state.units.values()).filter(
      u => u.owner === role && u.type === "huangjin_lishi"
    );
    if (lishiList.length === 0) return;

    for (const u of lishiList) {
      u.type = "huangjin_zei";
      u.charged = true;
      // 失去纪律：本回合还没用掉的攻击权直接作废
      u.hasAttacked = true;
    }

    const who = role === "player1" ? "玩家1" : "玩家2";
    this.addBattleLog(
      `起义！${who}的 ${lishiList.length} 名黄巾力士失去信仰，化为黄巾贼（作乱充能已充满）`
    );
    this.broadcast("qiyi", { by: role, count: lishiList.length });
  }

  /** 当前这方的黄天当立条件清单 */
  private huangtianConditionsOf(role: "player1" | "player2"): Rules.HuangtianConditions {
    const tp = this.taipingOf(role);
    return Rules.getHuangtianConditions(
      this.taipingGeneralOf(role) as unknown as Rules.UnitLike | undefined,
      this.unitList,
      tp.destiny,
      tp.fushuiUsedThisTurn
    );
  }

  /**
   * 宣告「黄天当立」。
   *
   * 手动而不是自动：宣告会给对手一个完整回合去反制（打死太平、把他赶出交战区、
   * 杀平民压天命、或者什么都不做赌他撑不住），所以**什么时候宣告**本身是个决策
   * —— 条件满足但不宣告，对手就得不到预警。
   */
  private handleTaipingDeclareHuangtian(client: Client) {
    const role = this.getPlayerRole(client);
    if (!role || role !== this.state.currentPlayer) {
      client.send("error", { message: "不是你的回合" });
      return;
    }
    if (!this.hasTaiping(role)) {
      client.send("error", { message: "你没有太平" });
      return;
    }
    if (!this.taipingGeneralOf(role)) {
      client.send("error", { message: "太平已阵亡，永久失去黄天当立" });
      return;
    }

    const tp = this.taipingOf(role);
    if (tp.huangtianDeclaredTurn >= 0) {
      client.send("error", { message: "黄天当立已在宣告中" });
      return;
    }

    const c = this.huangtianConditionsOf(role);
    if (!c.ok) {
      const missing = [
        !c.destinyEnough ? `天命不足 ${Rules.HUANGTIAN_DESTINY}（当前 ${tp.destiny}）` : '',
        !c.inBattleZone ? '太平不在交战区' : '',
        !c.fushuiUsed ? '本回合未使用符水粥' : '',
        !c.withinCapacity ? '黄巾力士超出承载' : '',
      ].filter(Boolean);
      client.send("error", { message: `无法宣告黄天当立：${missing.join('、')}` });
      return;
    }

    tp.huangtianDeclaredTurn = this.state.turn;
    const who = role === "player1" ? "玩家1" : "玩家2";
    this.addBattleLog(`⚡ ${who}宣布「黄天当立」！对手有一个完整回合可以反制`);
    this.broadcast("huangtianDeclared", { by: role, turn: this.state.turn });
  }

  /**
   * 宣告后的复查：条件被破坏就作废。
   *
   * 两个复查点 —— 宣告那一回合的结算之后（夺天命可能把天命打回 9，
   * 天命难承可能让力士超载甚至压死太平），以及对手回合结束之后。
   */
  private revalidateHuangtian(role: "player1" | "player2", when: string): boolean {
    const tp = this.taipingOf(role);
    if (tp.huangtianDeclaredTurn < 0) return false;

    const c = this.huangtianConditionsOf(role);
    if (Rules.huangtianStillHolds(c)) return true;

    const who = role === "player1" ? "玩家1" : "玩家2";
    const broken = [
      !c.destinyEnough ? '天命跌破 10' : '',
      !c.inBattleZone ? '太平离开交战区' : '',
      !c.withinCapacity ? '黄巾力士超出承载' : '',
    ].filter(Boolean);
    tp.huangtianDeclaredTurn = -1;
    this.addBattleLog(`${who}的黄天当立宣告失效（${when}：${broken.join('、')}），需重新满足条件再次宣告`);
    this.broadcast("huangtianCancelled", { by: role, reason: broken.join('、') });
    return false;
  }

  /**
   * 回合开始时结算宣告：对手的一个完整回合已经过去，条件仍成立则此刻取胜。
   *
   * 时序用一个数字就够：宣告记下当时的 `turn`，判定点恒为 `turn === 宣告回合 + 1`
   * —— turn 只在切回 player1 时 ++，所以 player1 在第 N 回合宣告、
   * 下一次轮到他是第 N+1 回合；player2 在第 N 回合宣告，中间经过 player1 的
   * 第 N+1 回合，再轮到他时 turn 也正好是 N+1。两边都成立。
   *
   * @returns true = 游戏已经结束，调用方应立刻返回
   */
  private resolveHuangtianDeclaration(role: "player1" | "player2"): boolean {
    const tp = this.taipingOf(role);
    if (tp.huangtianDeclaredTurn < 0) return false;
    if (this.state.turn !== tp.huangtianDeclaredTurn + 1) return false;

    if (!this.revalidateHuangtian(role, "对手反制")) return false;

    const who = role === "player1" ? "玩家1" : "玩家2";
    this.addBattleLog(`⚡⚡ 苍天已死，黄天当立！${who}达成特殊胜利！`);
    this.state.phase = "end";
    this.broadcast("phaseChange", { phase: "end" });
    this.broadcast("gameEnd", {
      winner: role,
      reason: "huangtian",
      message: `${who}以「黄天当立」获胜！`,
    });
    return true;
  }

  /**
   * 开启强制豆饭阶段：把本回合必须征募的平民快照进 pendingRecruit。
   *
   * 快照而不是每次重算，正是「本阶段新转化的力士不能继续扩大本次征募范围」
   * 的实现方式 —— 新力士虽然也是合格征募源，但它进场时这张名单已经定了。
   *
   * 太平阵亡后没有豆饭（那时是腐化，见步骤 11）。
   */
  private startDoufanPhase(role: "player1" | "player2"): void {
    if (!this.isTaipingAlive(role)) return;

    const tp = this.taipingOf(role);
    tp.pendingRecruit.clear();

    const targets = Rules.getDoufanTargets(this.unitList, role);
    if (targets.length === 0) return;

    targets.forEach(id => tp.pendingRecruit.push(id));

    const who = role === "player1" ? "玩家1" : "玩家2";
    this.addBattleLog(
      `强制豆饭：${targets.length} 名平民在征募范围内，每人 ${Rules.DOUFAN_COST} 点行动值`
      + `（${who}自行决定顺序）`
    );

    // 本来就付不起的话立刻放行，别把玩家锁在一个做不了的阶段里
    this.maybeEndDoufanPhase(role);
  }

  /**
   * 行动点不足 2 时结束征募阶段：不透支、不欠账、不额外处罚。
   *
   * 强制阶段期间玩家的其他指令全被拦住，所以 AP 只可能因为征募本身减少，
   * 在阶段开始和每次征募之后各查一次就够。
   */
  private maybeEndDoufanPhase(role: "player1" | "player2"): void {
    const tp = this.taipingOf(role);
    if (tp.pendingRecruit.length === 0) return;

    const ap = role === "player1" ? this.state.player1ActionPoints : this.state.player2ActionPoints;
    if (ap >= Rules.DOUFAN_COST) return;

    const left = tp.pendingRecruit.length;
    tp.pendingRecruit.clear();
    this.addBattleLog(`行动点不足，豆饭征募停止（${left} 名平民未被征募）`);
  }

  /**
   * 征募一名平民为黄巾力士。玩家逐个发，顺序由他自己定。
   *
   * 不占用征募源步兵的行动次数 —— 豆饭是被动，不是那些步兵的动作。
   * 新力士当回合不能行动（把行动次数和两个标记一起打满），但**立即计入
   * 天命承载量**，所以同一回合末的天命难承会算上它。
   */
  private handleTaipingRecruit(client: Client, data: { civilianId: string }) {
    const role = this.getPlayerRole(client);
    if (!role || role !== this.state.currentPlayer) {
      client.send("error", { message: "不是你的回合" });
      return;
    }

    const tp = this.taipingOf(role);
    const idx = tp.pendingRecruit.indexOf(data?.civilianId);
    if (idx < 0) {
      client.send("error", { message: "该平民不在本回合的征募名单里" });
      return;
    }

    const civ = this.state.units.get(data.civilianId);
    if (!civ) {
      // 理论上进不来（强制阶段里其他指令都被拦住），留着兜底
      tp.pendingRecruit.splice(idx, 1);
      this.maybeEndDoufanPhase(role);
      client.send("error", { message: "该平民已不在场" });
      return;
    }

    const ap = role === "player1" ? this.state.player1ActionPoints : this.state.player2ActionPoints;
    if (ap < Rules.DOUFAN_COST) {
      // maybeEndDoufanPhase 本该已经清空队列，这里兜底
      this.maybeEndDoufanPhase(role);
      client.send("error", { message: "行动点不足" });
      return;
    }
    if (role === "player1") {
      this.state.player1ActionPoints -= Rules.DOUFAN_COST;
    } else {
      this.state.player2ActionPoints -= Rules.DOUFAN_COST;
    }

    const pos = { q: civ.q, r: civ.r, s: civ.s };
    this.state.units.delete(civ.id);

    const lishi = new UnitSchema();
    lishi.id = this.newUnitId("lishi");
    lishi.type = "huangjin_lishi";
    lishi.owner = role;
    lishi.q = pos.q;
    lishi.r = pos.r;
    lishi.s = pos.s;
    lishi.hp = 2;
    lishi.maxHp = 2;
    lishi.direction = 0;
    // 当回合不能行动
    lishi.actionsThisTurn = 2;
    lishi.hasMoved = true;
    lishi.hasAttacked = true;
    lishi.hasActedThisTurn = true;
    this.state.units.set(lishi.id, lishi);

    tp.pendingRecruit.splice(idx, 1);

    const who = role === "player1" ? "玩家1" : "玩家2";
    this.addBattleLog(
      `${who}以豆饭征募平民${civ.id}，成为黄巾力士${lishi.id}`
      + `（剩余 ${tp.pendingRecruit.length} 名待征募）`
    );

    this.maybeEndDoufanPhase(role);
  }

  /**
   * 开启强制腐化阶段：把本回合必须尝试腐化的贼快照进 pendingCorrupt。
   *
   * 只在太平已阵亡的一方触发 —— 太平活着时黄巾是力士，走的是豆饭。
   * 和豆饭一样用快照，这就是「新腐化的贼不参与本次判定」的实现方式，
   * 否则会在同一回合无限连锁。
   */
  private startCorruptPhase(role: "player1" | "player2"): void {
    if (!this.hasTaiping(role)) return;
    if (this.isTaipingAlive(role)) return;

    const tp = this.taipingOf(role);
    tp.pendingCorrupt.clear();

    const candidates = Rules.getCorruptCandidates(this.unitList, role);
    if (candidates.length === 0) return;

    candidates.forEach(id => tp.pendingCorrupt.push(id));
    this.addBattleLog(
      `强制腐化：${candidates.length} 名充能黄巾贼与平民相邻，必须各自腐化一人`
    );
  }

  /**
   * 剔除已经无事可做的贼。
   *
   * 和豆饭的结束条件不同：腐化不花行动点，所以不会「付不起」，
   * 只会「没得腐化」—— 自己的充能被用掉了，或者相邻的平民被别的贼抢走了。
   * 规则里「如存在多个可选目标由控制方决定」和「另一只贼若无其他目标则跳过」
   * 两句，合起来就是这个剪枝。
   */
  private prunePendingCorrupt(role: "player1" | "player2"): void {
    const tp = this.taipingOf(role);
    if (tp.pendingCorrupt.length === 0) return;

    const stale: string[] = [];
    for (const id of Array.from(tp.pendingCorrupt)) {
      const z = this.state.units.get(id);
      const canStill = z && Rules.getCorruptTargets(
        z as unknown as Rules.UnitLike, this.unitList
      ).length > 0;
      if (!canStill) stale.push(id);
    }

    for (const id of stale) {
      const idx = tp.pendingCorrupt.indexOf(id);
      if (idx >= 0) tp.pendingCorrupt.splice(idx, 1);
    }
    if (stale.length > 0) {
      this.addBattleLog(`${stale.length} 名黄巾贼已无可腐化的平民，跳过`);
    }
  }

  /**
   * 腐化一名相邻平民：平民变成 1 血、充能充满的黄巾贼，施术的贼耗尽充能。
   *
   * 新贼当回合不能主动移动（所以也不会靠移动立刻把充能充回来），
   * 但它的充能是满的 —— 从对手回合起就能作乱。
   */
  private handleTaipingCorrupt(client: Client, data: { zeiId: string; civilianId: string }) {
    const role = this.getPlayerRole(client);
    if (!role || role !== this.state.currentPlayer) {
      client.send("error", { message: "不是你的回合" });
      return;
    }

    const tp = this.taipingOf(role);
    const idx = tp.pendingCorrupt.indexOf(data?.zeiId);
    if (idx < 0) {
      client.send("error", { message: "该黄巾贼不在本回合的腐化名单里" });
      return;
    }

    const zei = this.state.units.get(data.zeiId);
    if (!zei) {
      tp.pendingCorrupt.splice(idx, 1);
      this.prunePendingCorrupt(role);
      client.send("error", { message: "该黄巾贼已不在场" });
      return;
    }

    const targets = Rules.getCorruptTargets(zei as unknown as Rules.UnitLike, this.unitList);
    if (!targets.includes(data?.civilianId)) {
      client.send("error", { message: "只能腐化与该黄巾贼相邻的平民" });
      return;
    }

    const civ = this.state.units.get(data.civilianId)!;
    const pos = { q: civ.q, r: civ.r, s: civ.s };
    this.state.units.delete(civ.id);

    const born = new UnitSchema();
    born.id = this.newUnitId("zei");
    born.type = "huangjin_zei";
    born.owner = role;
    born.q = pos.q;
    born.r = pos.r;
    born.s = pos.s;
    born.hp = 1;
    born.maxHp = 2;
    born.direction = 0;
    born.charged = true;
    // 当回合不能主动移动，也不能再参与本次腐化
    born.actionsThisTurn = 2;
    born.hasMoved = true;
    born.hasAttacked = true;
    born.hasActedThisTurn = true;
    this.state.units.set(born.id, born);

    // 腐化与作乱共用这一个开关：用掉就耗尽
    zei.charged = false;

    tp.pendingCorrupt.splice(idx, 1);

    const who = role === "player1" ? "玩家1" : "玩家2";
    this.addBattleLog(
      `${who}的黄巾贼${zei.id}腐化平民${civ.id}，化为黄巾贼${born.id}（1 血，充能充满）`
    );

    this.prunePendingCorrupt(role);
  }

  /**
   * 强制阶段未完成时拦住行动方的其他指令。
   *
   * 「只要存在合格目标且行动点足够，太平玩家就不能主动拒绝征募」——
   * 这条规则靠拦截实现：队列非空期间移动、攻击、部署、符水粥、结束回合
   * 一律被拒。队列会在 AP 不足时自动清空，所以玩家不会被永久锁住。
   *
   * @returns true = 已经回绝，调用方应直接 return
   */
  private rejectIfForcedPhasePending(client: Client): boolean {
    const role = this.getPlayerRole(client);
    // 不是行动方就不关这里的事，交给各 handler 自己回「不是你的回合」
    if (!role || role !== this.state.currentPlayer) return false;

    const tp = this.taipingOf(role);
    if (tp.pendingRecruit.length > 0) {
      client.send("error", {
        message: `强制豆饭未完成：还有 ${tp.pendingRecruit.length} 名平民等待征募`,
      });
      return true;
    }
    if (tp.pendingCorrupt.length > 0) {
      client.send("error", {
        message: `强制腐化未完成：还有 ${tp.pendingCorrupt.length} 名黄巾贼等待腐化平民`,
      });
      return true;
    }
    return false;
  }

  /**
   * 信仰不死：黄巾力士体力耗尽时不阵亡，而是化为 1 血的中立平民。
   *
   * 用「删掉力士 + 新建平民」而不是原地改 type，是为了战报和测试能读
   * —— `lishi2 化为 civ9` 比「某个单位的 type 变了」清楚得多，
   * 而且新 id 让「这个平民是从力士来的」在日志里留了痕。
   *
   * 不走刷新的 5 名上限（转化来的平民不受限），但新平民会计入场上总数，
   * 从而挤掉之后的自动刷新。承载量的释放不需要额外处理：
   * countLishi 只认 type === huangjin_lishi，type 一换就自动不算了。
   */
  private convertLishiToCivilian(lishi: UnitSchema): void {
    const who = lishi.owner === "player1" ? "玩家1" : "玩家2";
    const pos = { q: lishi.q, r: lishi.r, s: lishi.s };
    this.state.units.delete(lishi.id);
    const civ = this.spawnCivilian(pos);
    this.addBattleLog(`${who}的黄巾力士${lishi.id}体力耗尽，失去信仰化为平民${civ.id}`);
  }

  /**
   * 符水粥：花 2 AP 救济一名相邻的平民，天命 +1。
   *
   * 救济**不是击杀**：平民是被带离战场而不是死掉，所以走裸 delete 而不是
   * killUnit —— 否则会同时触发「平民死亡扣天命」，一加一减白忙一场，
   * 双太平时还会连带扣掉对手那个太平的天命。
   *
   * 代价不只是 2 AP：它占掉太平的一次行动，并且**算作本回合的攻击类行动**，
   * 所以同一回合不能再普通攻击。可以先移动再救济，但将领每回合仍然最多两次行动。
   *
   * 天命 12 时照样能用 —— 天命不再上涨，但消耗照付、本回合已用照记。
   * 因为「黄天当立」硬性要求宣告回合内成功使用过符水粥，不能让满天命堵死这条路。
   */
  private handleTaipingFushui(client: Client, data: { civilianId: string }) {
    const role = this.getPlayerRole(client);
    if (!role || role !== this.state.currentPlayer) {
      client.send("error", { message: "不是你的回合" });
      return;
    }

    const general = this.taipingGeneralOf(role);
    if (!general) {
      client.send("error", { message: "太平不在场" });
      return;
    }

    const tp = this.taipingOf(role);
    const targets = Rules.getFushuiTargets(
      general as unknown as Rules.UnitLike,
      this.unitList,
      tp.fushuiUsedThisTurn
    );

    if (!targets.includes(data?.civilianId)) {
      // 把三种常见原因分开说，否则玩家只会看到一句「不能救济」
      const reason = tp.fushuiUsedThisTurn
        ? "符水粥本回合已经用过了"
        : general.hasAttacked
          ? "太平本回合已使用攻击类行动，不能再施符水粥"
          : general.actionsThisTurn >= 2 + (general.bonusActionLimit || 0)
            ? "太平本回合行动次数已用尽"
            : "只能救济与太平相邻的平民";
      client.send("error", { message: reason });
      return;
    }

    const ap = role === "player1" ? this.state.player1ActionPoints : this.state.player2ActionPoints;
    if (ap < Rules.FUSHUI_COST) {
      client.send("error", { message: `行动点不足（符水粥需要 ${Rules.FUSHUI_COST} 点）` });
      return;
    }
    if (role === "player1") {
      this.state.player1ActionPoints -= Rules.FUSHUI_COST;
    } else {
      this.state.player2ActionPoints -= Rules.FUSHUI_COST;
    }

    const civ = this.state.units.get(data.civilianId)!;
    this.state.units.delete(civ.id);

    const before = tp.destiny;
    tp.destiny = Math.min(Rules.DESTINY_MAX, tp.destiny + 1);
    tp.fushuiUsedThisTurn = true;

    general.actionsThisTurn += 1;
    general.hasAttacked = true;

    const who = role === "player1" ? "玩家1" : "玩家2";
    this.addBattleLog(
      `${who}施符水粥救济平民${civ.id}，天命 ${before}→${tp.destiny}` +
      (before === tp.destiny ? `（天命已满）` : ``)
    );
  }

  /**
   * 太平回合结束的结算：夺天命 → 天命难承。
   *
   * 顺序按规则书 §7.1 的第 5、6 步，**不能交换** ——
   * 天命难承比较的是夺天命**之后**的承载量，所以这一回合骰出来的 ±1
   * 当场就决定了会不会掉血。
   *
   * 太平阵亡后整段跳过（§7.2：不再结算天命骰、天命承载、符水粥）。
   *
   * 旧实现把这件事拆成「结算天命」「结束回合」两个必点按钮，
   * 中间还要一个 Schema 状态挂住。现在合并成一步：点结束回合时一次算完，
   * 骰子结果写进 lastHuangtian / lastCangtian 供界面展示。
   */
  private settleDestiny(role: "player1" | "player2"): void {
    const general = this.taipingGeneralOf(role);
    if (!general) return; // 没选太平，或太平已阵亡

    const tp = this.taipingOf(role);
    const who = role === "player1" ? "玩家1" : "玩家2";

    // ── 夺天命 ──
    const huangtian = this.rollD6();
    const cangtian = this.rollD6();
    tp.lastHuangtian = huangtian;
    tp.lastCangtian = cangtian;

    const before = tp.destiny;
    if (huangtian > cangtian) {
      tp.destiny = Math.min(Rules.DESTINY_MAX, tp.destiny + 1);
    } else if (huangtian < cangtian) {
      tp.destiny = Math.max(Rules.DESTINY_MIN, tp.destiny - 1);
    }
    this.addBattleLog(
      `${who}夺天命：黄天${huangtian} / 苍天${cangtian}，天命 ${before}→${tp.destiny}`
    );

    // ── 天命难承 ──
    const capacity = Rules.getDestinyCapacity(tp.destiny);
    const lishi = Rules.countLishi(this.unitList, role);

    if (Rules.isOverCapacity(tp.destiny, lishi)) {
      // 超出多少都只掉 1 点，且不走任何减伤路径（直接改 hp）
      general.hp -= 1;
      this.addBattleLog(
        `天命难承！${who}的黄巾力士 ${lishi} 超出承载 ${capacity}，太平体力 ${general.hp + 1}→${general.hp}`
      );

      if (general.hp <= 0) {
        this.killUnit(general);
        // §7.1 末尾：「如果太平在天命难承阶段死亡，立即执行黄巾腐化」。
        // 不等到下个回合开始 —— 将领倒下的那一刻黄巾就转向了百姓。
        this.startCorruptPhase(role);
        return; // 阵亡的处理里已经作废了宣告，没有后续
      }
    } else if (lishi > 0) {
      this.addBattleLog(`${who}的黄巾力士 ${lishi}/${capacity}，承载正常`);
    }

    // ── §7.1 第 7 步：胜利判定 ──
    // 这里不是「赢了吗」，而是「本回合宣告的黄天当立还站得住吗」：
    // 夺天命可能刚把天命打回 9，天命难承可能刚让力士超载。
    // 注意不能写成 if 的 early return —— 没超载（也就是黄天当立路线的
    // 常态）才最需要走到这一步。
    this.revalidateHuangtian(role, "回合结算");
  }

  // ========================================
  // 太平将军
  // ========================================

  /** 某方的太平阵营状态 */
  private taipingOf(role: "player1" | "player2"): TaipingSchema {
    return role === "player1" ? this.state.player1Taiping : this.state.player2Taiping;
  }

  /** 某方是否选了太平（将军死了也仍然成立 —— 死后阶段的规则要靠它） */
  private hasTaiping(role: "player1" | "player2"): boolean {
    const g = role === "player1" ? this.state.player1General : this.state.player2General;
    return g === "taiping";
  }

  /** 某方的太平将军单位，阵亡后为 undefined */
  private taipingGeneralOf(role: "player1" | "player2"): UnitSchema | undefined {
    return Array.from(this.state.units.values()).find(
      u => u.owner === role && u.type === "general" && u.generalType === "taiping"
    );
  }

  /**
   * 某方的太平是否存活 —— 「黄天未立」与「苍天已死」两个阶段的分界。
   *
   * 刻意推导而不是存一个 `alive` 字段：存一份就会有漂移的机会，
   * 而这两个来源（选将配置 + 场上单位）本来就都是权威状态。
   */
  private isTaipingAlive(role: "player1" | "player2"): boolean {
    return this.hasTaiping(role) && this.taipingGeneralOf(role) !== undefined;
  }

  /** 任一方选了太平就启用公共平民机制 */
  private get civiliansEnabled(): boolean {
    return this.hasTaiping("player1") || this.hasTaiping("player2");
  }

  /** 双方大本营格，平民不能刷在这上面 */
  private get baseHexes(): HexCoord[] {
    return [
      { q: this.state.player1BaseQ, r: this.state.player1BaseR, s: this.state.player1BaseS },
      { q: this.state.player2BaseQ, r: this.state.player2BaseR, s: this.state.player2BaseS },
    ];
  }

  /** 在指定格子放一名公共平民 */
  private spawnCivilian(hex: HexCoord): UnitSchema {
    const civ = new UnitSchema();
    civ.id = this.newUnitId("civ");
    civ.type = "neutral_marker";
    civ.owner = "neutral";
    civ.statusTag = Rules.CIVILIAN_TAG;
    civ.q = hex.q;
    civ.r = hex.r;
    civ.s = hex.s;
    civ.hp = 1;
    civ.maxHp = 1;
    civ.direction = 0;
    this.state.units.set(civ.id, civ);
    return civ;
  }

  /**
   * 回合开始刷新公共平民。
   *
   * 数量：太平存活时按天命（0–3→1 / 4–8→2 / 9–12→3）；
   * 太平死后不看天命，固定 1 名。两种情况都受场上 5 名的上限约束。
   *
   * 位置：在刷新范围（天命 0–4 为交战区 + 己方起始区 70 格，
   * 5–12 为仅交战区 49 格）里随机取空格，排除单位、机关车身和双方大本营。
   *
   * 力士被击败转化来的平民不走这里，所以不受上限限制 —— 但它们计入场上总数，
   * 会挤掉后续的自动刷新。
   */
  private refreshCivilians(role: "player1" | "player2"): void {
    // 部署阶段不刷新
    if (this.state.phase !== "action") return;
    if (!this.hasTaiping(role)) return;

    const tp = this.taipingOf(role);
    const alive = this.isTaipingAlive(role);

    const onBoard = Rules.countCivilians(this.unitList);
    const room = Rules.CIVILIAN_CAP - onBoard;
    if (room <= 0) return;

    const want = alive ? Rules.getCivilianSpawnCount(tp.destiny) : 1;
    const count = Math.min(want, room);

    // 范围始终按天命算。太平死后天命不再结算，但值还在，范围就按那个值冻结
    const pool = Rules.getCivilianSpawnCells(
      tp.destiny,
      role,
      this.unitList,
      this.baseHexes
    );
    if (pool.length === 0) {
      this.addBattleLog(`流民无处容身：刷新范围内没有空格`);
      return;
    }

    const spawned: string[] = [];
    for (let i = 0; i < count && pool.length > 0; i++) {
      const idx = Math.floor(this.rng() * pool.length);
      const hex = pool.splice(idx, 1)[0]!;
      const civ = this.spawnCivilian(hex);
      spawned.push(`${civ.id}(${hex.q},${hex.r},${hex.s})`);
    }

    this.addBattleLog(
      `流民涌来：${spawned.length}名平民出现于 ${spawned.join('、')}` +
      `（天命${tp.destiny}${alive ? '' : '，太平已死固定1名'}）`
    );
  }

  /**
   * 处理认输
   */
  private handleSurrender(client: Client) {
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
