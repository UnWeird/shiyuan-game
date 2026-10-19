import { Client, Room } from 'colyseus.js';
import { useGameStore } from '../stores/gameStore';
import { useUIStore, toast } from '../stores/uiStore';
import { playSfx } from '../audio/sfx';
import { pendingAction, reconcilePending } from '../game/pendingAction';
import { validActions, type ValidActionsPayload } from '../game/validActions';
import { GeneralType, Player } from '../types';
import type { TaipingState } from '../types';

/**
 * Colyseus 网络服务
 * 负责与服务器通信、房间管理、状态同步
 */
/**
 * 嵌套的 TaipingSchema → 普通对象。
 *
 * ArraySchema 必须显式展开：直接塞进 zustand 的话组件拿到的是同一个
 * 可变引用，内容变了引用没变，React 不会重渲染。
 */
function toTaipingState(tp: any): TaipingState {
  return {
    destiny: tp?.destiny ?? 5,
    destinyLostThisRound: tp?.destinyLostThisRound ?? 0,
    fushuiUsedThisTurn: tp?.fushuiUsedThisTurn ?? false,
    lastHuangtian: tp?.lastHuangtian ?? 0,
    lastCangtian: tp?.lastCangtian ?? 0,
    huangtianDeclaredTurn: tp?.huangtianDeclaredTurn ?? -1,
    pendingRecruit: tp?.pendingRecruit ? Array.from(tp.pendingRecruit) as string[] : [],
    pendingCorrupt: tp?.pendingCorrupt ? Array.from(tp.pendingCorrupt) as string[] : [],
  };
}

class ColyseusService {
  private client: Client;
  private room: Room | null = null;
  private myPlayerRole: 'player1' | 'player2' | 'spectator' | null = null;
  /** 上一次同步时的单位 id，用于检测击杀（单位从 state 里消失）并发声 */
  private previousUnitIds: Set<string> = new Set();

  constructor() {
    // 连接到服务器（支持环境变量配置）
    const serverUrl = import.meta.env.VITE_SERVER_URL || 'ws://localhost:2567';
    this.client = new Client(serverUrl);
    console.log('🔗 连接到服务器:', serverUrl);
  }

  /**
   * 创建新房间
   */
  async createRoom(options: { hotseat?: boolean } = {}): Promise<string> {
    try {
      this.room = await this.client.create('shiyuan_room', options);
      this.saveReconnectionToken();
      this.setupRoomListeners();
      console.log('✅ 房间创建成功:', this.room.roomId);
      return this.room.roomId;
    } catch (error) {
      console.error('❌ 创建房间失败:', error);
      throw error;
    }
  }

  /**
   * 加入已有房间
   */
  async joinRoom(roomId: string, asSpectator: boolean = false): Promise<void> {
    try {
      this.room = await this.client.joinById(roomId, { spectator: asSpectator });
      this.saveReconnectionToken();
      this.setupRoomListeners();
      console.log(`✅ 加入房间成功 (${asSpectator ? '观战者' : '玩家'}):`, roomId);
    } catch (error) {
      console.error('❌ 加入房间失败:', error);
      throw error;
    }
  }

  /** 将重连 token 存入 localStorage */
  private saveReconnectionToken() {
    if (!this.room) return;
    try {
      localStorage.setItem('sy_reconnectionToken', this.room.reconnectionToken);
      localStorage.setItem('sy_roomId', this.room.roomId);
      console.log('💾 重连 token 已保存');
    } catch (e) {
      console.warn('无法保存重连 token:', e);
    }
  }

  /** 清除 localStorage 中的重连 token */
  private clearReconnectionToken() {
    localStorage.removeItem('sy_reconnectionToken');
    localStorage.removeItem('sy_roomId');
  }

  /**
   * 设置房间监听器
   */
  private setupRoomListeners() {
    if (!this.room) return;

    // 监听玩家角色分配（含接管/重连场景）
    this.room.onMessage('role', (data: {
      role: 'player1' | 'player2' | 'spectator';
      message: string;
      takenOver?: boolean;
      reconnected?: boolean;
      gamePhase?: string;
      actionPoints?: number;
      currentPlayer?: string;
      hotseat?: boolean;
    }) => {
      this.myPlayerRole = data.role;
      console.log('👤 我的角色:', data.role, data);

      useGameStore.setState({
        isOnlineMode: true,
        myPlayerRole: data.role,
        ...(data.hotseat ? { isHotseat: true } : {}),
      });

      // 接管或重连时弹出提示
      if (data.takenOver || data.reconnected) {
        const roleLabel =
          data.role === 'spectator' ? '观战者' : data.role === 'player1' ? '朱红' : '青玉';
        const actionLabel = data.takenOver ? '接管' : '重连';
        toast.success(
          `你的身份：${roleLabel}\n` +
          `当前行动方：${data.currentPlayer === 'player1' ? '朱红' : data.currentPlayer === 'player2' ? '青玉' : '未知'}\n` +
          `可用行动点：${data.actionPoints ?? 0}`,
          `${actionLabel}成功`
        );
      }
    });

    // 监听游戏开始
    this.room.onMessage('gameStart', (data: { message: string }) => {
      console.log('🎮 游戏开始:', data.message);
    });

    // 监听阶段变化
    this.room.onMessage('phaseChange', (data: { phase: string }) => {
      console.log('📍 阶段切换:', data.phase);
    });

    // 监听回合变化
    this.room.onMessage('turnChange', (data: { currentPlayer: string }) => {
      console.log('🔄 回合切换:', data.currentPlayer);
      playSfx('turn');
    });

    // 监听错误消息（非法操作被服务端拒绝）
    this.room.onMessage('error', (data: { message: string }) => {
      console.error('❌ 服务器错误:', data.message);
      // 指令被拒：回滚乐观显示（幽灵棋子消失 + 原棋子抖一下）
      pendingAction.reject();
      toast.error(data.message);
    });

    // 监听信息消息
    this.room.onMessage('info', (data: { message: string }) => {
      console.log('ℹ️  服务器信息:', data.message);
      toast.info(data.message);
    });

    // 监听玩家离开（主动）
    this.room.onMessage('playerLeft', (data: { role: string; message: string }) => {
      console.log('👋 玩家离开:', data.message);
      toast.warn(data.message, '对手离开');
    });

    // 监听玩家断线
    this.room.onMessage('playerDisconnected', (data: { role: string; message: string }) => {
      console.log('⚠️ 玩家断线:', data.message);
      toast.warn(data.message, '对手断线');
    });

    // 监听断线槽位已释放（60秒超时，可加入新玩家）
    this.room.onMessage('playerSlotOpen', (data: { role: string; message: string }) => {
      console.log('🔓 槽位释放:', data.message);
      toast.info(data.message, '席位开放');
    });

    // 监听新玩家接管
    this.room.onMessage('playerTookOver', (data: { role: string; message: string }) => {
      console.log('🔄 玩家接管:', data.message);
      toast.info(data.message, '有人接管');
    });

    // 监听玩家重连
    this.room.onMessage('playerReconnected', (data: { role: string; message: string }) => {
      console.log('✅ 玩家重连:', data.message);
      toast.success(data.message, '对手已重连');
    });

    /* ── 太平：这几件事都「发生在玩家身上」，不是他操作的结果 ──
     *
     * 强制豆饭够付时服务端会自动执行完，不打断玩家。但它吃掉的行动点很可观，
     * 只写进战报玩家会以为自己的骰子投小了 —— 所以必须有一个当面的提示。
     * 这正是「被不断膨胀的队伍拖垮」要让人感觉到的东西。
     */
    this.room.onMessage('doufanAuto', (data: { by: string; count: number }) => {
      if (data.by !== this.myPlayerRole) return;
      toast.warn(`${data.count} 名流民加入黄巾军，耗去 ${data.count * 2} 点行动值`, '豆饭');
    });

    // 起义：将领倒下的那一瞬间，全部力士同时失去信仰
    this.room.onMessage('qiyi', (data: { by: string; count: number }) => {
      const mine = data.by === this.myPlayerRole;
      toast.warn(
        `${data.count} 名黄巾力士失去信仰，化为黄巾贼`,
        mine ? '苍天已死' : '敌方黄巾哗变'
      );
    });

    this.room.onMessage('huangtianDeclared', (data: { by: string }) => {
      const mine = data.by === this.myPlayerRole;
      toast.warn(
        mine ? '撑过对手这一回合即可取胜' : '对方宣告黄天当立 —— 你只有这一个回合反制',
        '黄天当立'
      );
    });

    this.room.onMessage('huangtianCancelled', (data: { by: string; reason: string }) => {
      const mine = data.by === this.myPlayerRole;
      toast.info(`${mine ? '你的' : '对方的'}黄天当立宣告失效（${data.reason}）`, '宣告失效');
    });

    // 监听游戏结束：交给结算画面，不再用 alert
    this.room.onMessage('gameEnd', (data: { winner: string; message: string }) => {
      console.log('🏆 游戏结束:', data.message);
      useUIStore.getState().setGameOver({ winner: data.winner, message: data.message });
    });

    // 监听观战者加入
    this.room.onMessage('spectatorJoined', (data: { spectatorCount: number; message: string }) => {
      console.log('👁️  观战者加入:', data);
    });

    // 监听仁德击杀确认请求
    this.room.onMessage('rendeKillConfirm', (data: { attackerId: string; targetId: string; targetType: string; targetOwner: string }) => {
      console.log('⚔️ 仁德击杀确认:', data);
      // 触发状态更新，让 GameBoard 显示确认对话框
      const units = useGameStore.getState().units;
      const attacker = units[data.attackerId];
      const target = units[data.targetId];

      if (attacker && target) {
        // 使用 custom event 通知 GameBoard
        window.dispatchEvent(new CustomEvent('rendeKillConfirm', {
          detail: { attacker, target }
        }));
      }
    });

    // 监听服务端下发的合法动作（高亮数据的唯一来源）
    this.room.onMessage('validActions', (payload: ValidActionsPayload) => {
      validActions.apply(payload);
    });

    // 监听状态变化（核心！）
    this.room.onStateChange((state) => {
      this.syncStateToStore(state);
    });

    // 监听房间错误
    this.room.onError((code, message) => {
      console.error('房间错误:', code, message);
      toast.error(message ?? `错误代码 ${code}`, '房间异常');
    });

    // 监听离开房间
    this.room.onLeave((code) => {
      console.log('离开房间, code:', code);

      // code 1000-1999 表示正常关闭，4000+ 表示异常断开
      if (code >= 4000) {
        console.log('⚠️ 异常断开连接，尝试重连...');
        // 异常断开，尝试重连
        this.attemptReconnection();
      } else {
        // 正常离开，清除重连 token
        this.room = null;
        this.myPlayerRole = null;
        this.clearReconnectionToken();
      }
    });
  }

  /**
   * 尝试重连：优先使用 room 对象上的 token，其次使用 localStorage 持久化的 token
   */
  private async attemptReconnection() {
    // 优先用内存中的 token，断线后 room 对象可能还存活
    const token =
      (this.room?.reconnectionToken) ||
      localStorage.getItem('sy_reconnectionToken');

    console.log('🔄 尝试重连...', { token });

    if (!token) {
      console.error('❌ 没有重连令牌，无法重连');
      this.room = null;
      this.myPlayerRole = null;
      this.clearReconnectionToken();
      toast.error('连接已断开，无法重连', '断线');
      return;
    }

    try {
      this.room = await this.client.reconnect(token);
      this.saveReconnectionToken(); // 更新 token
      this.setupRoomListeners();
      console.log('✅ 重连成功！');
    } catch (error) {
      console.error('❌ 重连失败:', error);
      this.room = null;
      this.myPlayerRole = null;
      this.clearReconnectionToken();
      toast.error('重连失败，请刷新页面重新加入', '断线');
    }
  }

  /**
   * 同步服务器状态到本地 Zustand Store
   */
  private syncStateToStore(state: any) {
    // 转换单位数据
    const units: Record<string, any> = {};
    if (state.units) {
      state.units.forEach((unit: any, id: string) => {
        // 如果是步兵且有移动限制，打印详细信息
        if (unit.type === 'infantry' && unit.movementRestricted) {
          console.log('[Colyseus同步] 发现被限制的步兵:', {
            id: unit.id,
            movementRestricted: unit.movementRestricted,
            sourceQ: unit.movementRestrictionSourceQ,
            sourceR: unit.movementRestrictionSourceR,
            sourceS: unit.movementRestrictionSourceS
          });
        }

        units[id] = {
          id: unit.id,
          type: unit.type,
          owner: unit.owner as Player,
          position: { q: unit.q, r: unit.r, s: unit.s },
          hp: unit.hp,
          maxHp: unit.maxHp,
          direction: unit.direction,
          actionsThisTurn: unit.actionsThisTurn,
          hasMoved: unit.hasMoved,
          hasAttacked: unit.hasAttacked,
          moveDistance: unit.moveDistance,
          movementRestricted: unit.movementRestricted,
          movementRestrictionSourceQ: unit.movementRestrictionSourceQ,
          movementRestrictionSourceR: unit.movementRestrictionSourceR,
          movementRestrictionSourceS: unit.movementRestrictionSourceS,
          cannotMoveNextTurn: unit.cannotMoveNextTurn,
          cannotRotateNextTurn: unit.cannotRotateNextTurn,
          statusTag: unit.statusTag || '',
          // 黄巾贼的作乱充能：棋子面色靠它区分，必须同步
          charged: unit.charged || false,
        };

        // 将军专属字段
        if (unit.type === 'general') {
          Object.assign(units[id], {
            generalType: unit.generalType,
            abilityUsed: unit.abilityUsed,
            isInvincible: unit.isInvincible,
            unlimitedActions: unit.unlimitedActions,
            hasFanAttacked: unit.hasFanAttacked,
            bonusActionLimit: unit.bonusActionLimit,
            canConvertNeutral: unit.canConvertNeutral,
            convertInfantryCost: unit.convertInfantryCost,
          });
        }

        // 机关单位专属字段
        if (unit.type === 'ballista' || unit.type === 'chariot' || unit.type === 'catapult') {
          Object.assign(units[id], {
            killCount: unit.killCount,
            pierceCount: unit.pierceCount,
            hasActedThisTurn: unit.hasActedThisTurn,
            chargeLevel: unit.chargeLevel, // 投石车蓄力层数
            hasCharged: unit.hasCharged,   // 投石车本回合是否已蓄力
          });
        }
      });
    }

    // 转换骰子结果
    const player1DiceResults = state.player1DiceResults ? Array.from(state.player1DiceResults) as number[] : [];
    const player2DiceResults = state.player2DiceResults ? Array.from(state.player2DiceResults) as number[] : [];

    // 转换扇形攻击状态
    const wushuangDiceRolls = state.wushuangDiceRolls ? Array.from(state.wushuangDiceRolls) as number[] : [];

    // 待确认动作的落定判定：放在击杀检测之前，
    // 保证幽灵棋子在真棋子就位的同一帧消失，不会闪一下两个棋子。
    reconcilePending(units);

    // 击杀检测：有单位从 state 里消失就发声。
    // 比对 id 集合比解析战报字符串可靠，且对双方玩家都会触发。
    const currentUnitIds = new Set(Object.keys(units));
    if (this.previousUnitIds.size > 0) {
      let removed = 0;
      this.previousUnitIds.forEach(id => {
        if (!currentUnitIds.has(id)) removed++;
      });
      if (removed > 0) playSfx('kill');
    }
    this.previousUnitIds = currentUnitIds;

    // 保存当前选中的单位ID（避免状态同步时清空选中）
    const currentSelectedUnitId = useGameStore.getState().selectedUnitId;

    // 更新 Zustand Store
    console.log(`[CLIENT DEBUG] 同步状态 - currentPlayer从服务器: ${state.currentPlayer}, 我的角色: ${this.myPlayerRole}`);
    // 同机轮流：服务端的 getPlayerRole 返回的就是 currentPlayer，
    // 这里让客户端的 myPlayerRole 跟着一起走，于是所有既有的
    // 「我方 / 对方」判断（isMyTurn、myGeneral、myArmy、myBase…）自动落到当前行动方，
    // 不需要把几十处 UI 分支重写一遍。
    const hotseatRole = useGameStore.getState().isHotseat
      ? (state.currentPlayer as 'player1' | 'player2')
      : null;

    useGameStore.setState({
      ...(hotseatRole ? { myPlayerRole: hotseatRole } : {}),

      // 服务端权威战报：以前完全没同步，客户端只显示自己猜的那份
      serverBattleLog: state.battleLog ? (Array.from(state.battleLog) as string[]) : [],

      phase: state.phase,
      currentPlayer: state.currentPlayer as Player,
      turn: state.turn,

      player1General: state.player1General ? state.player1General : null,
      player2General: state.player2General ? state.player2General : null,

      player1Base: state.player1BaseQ !== 0 || state.player1BaseR !== 0
        ? { q: state.player1BaseQ, r: state.player1BaseR, s: state.player1BaseS }
        : null,
      player2Base: state.player2BaseQ !== 0 || state.player2BaseR !== 0
        ? { q: state.player2BaseQ, r: state.player2BaseR, s: state.player2BaseS }
        : null,

      player1Army: {
        infantry: state.player1Infantry,
        cavalry: state.player1Cavalry,
        archer: state.player1Archer,
      },
      player2Army: {
        infantry: state.player2Infantry,
        cavalry: state.player2Cavalry,
        archer: state.player2Archer,
      },

      player1ConsumedStock: {
        infantry: state.player1ConsumedInfantry || 0,
        cavalry: state.player1ConsumedCavalry || 0,
        archer: state.player1ConsumedArcher || 0,
      },
      player2ConsumedStock: {
        infantry: state.player2ConsumedInfantry || 0,
        cavalry: state.player2ConsumedCavalry || 0,
        archer: state.player2ConsumedArcher || 0,
      },

      units,

      player1Dice: state.player1Dice,
      player2Dice: state.player2Dice,
      player1DiceResults,
      player2DiceResults,
      player1ActionPoints: state.player1ActionPoints,
      player2ActionPoints: state.player2ActionPoints,
      player1TempMaxActionPoints: state.player1TempMaxActionPoints === -1 ? null : state.player1TempMaxActionPoints,
      player2TempMaxActionPoints: state.player2TempMaxActionPoints === -1 ? null : state.player2TempMaxActionPoints,
      player1KillDice: state.player1KillDice,
      player2KillDice: state.player2KillDice,
      player1LostDice: state.player1LostDice,
      player2LostDice: state.player2LostDice,
      player1RerollTokens: state.player1RerollTokens,
      player2RerollTokens: state.player2RerollTokens,

      player1KilledThisTurn: state.player1KilledThisTurn,
      player2KilledThisTurn: state.player2KilledThisTurn,
      player1KilledLastTurn: state.player1KilledLastTurn,
      player2KilledLastTurn: state.player2KilledLastTurn,

      // 部署价值（用于显示和调试）
      player1DeployedValue: state.player1DeployedValue || 0,
      player2DeployedValue: state.player2DeployedValue || 0,

      // 保留客户端的选中状态（selectedUnitId 不从服务器同步）
      selectedUnitId: currentSelectedUnitId,

      // 扇形攻击状态
      wushuangFanAttackActive: state.wushuangFanAttackActive || false,
      wushuangAttackingPlayer: state.wushuangAttackingPlayer || '',
      wushuangAttackPhase: state.wushuangAttackPhase ? state.wushuangAttackPhase as any : 'select-direction',
      wushuangSelectedDirection: state.wushuangSelectedDirection === -1 ? null : state.wushuangSelectedDirection,
      wushuangDiceRolls,

      // 太平阵营状态（嵌套 Schema → 普通对象，ArraySchema 要展开成数组）
      player1Taiping: toTaipingState(state.player1Taiping),
      player2Taiping: toTaipingState(state.player2Taiping),
    });
  }

  /**
   * 获取我的角色
   */
  getMyRole(): 'player1' | 'player2' | 'spectator' | null {
    return this.myPlayerRole;
  }

  /**
   * 是否是观战者
   */
  isSpectator(): boolean {
    return this.myPlayerRole === 'spectator';
  }

  /**
   * 获取房间ID
   */
  getRoomId(): string | null {
    return this.room?.roomId || null;
  }

  /**
   * 是否已连接
   */
  isConnected(): boolean {
    return this.room !== null;
  }

  // ==================== 游戏操作 API ====================

  /**
   * 选择将领
   */
  selectGeneral(general: GeneralType) {
    if (!this.room) {
      console.error('未连接到房间');
      return;
    }
    this.room.send('selectGeneral', { general });
  }

  /**
   * 配置部队
   */
  buildArmy(army: { infantry: number; cavalry: number; archer: number }) {
    if (!this.room) {
      console.error('未连接到房间');
      return;
    }
    this.room.send('buildArmy', army);
  }

  /**
   * 设置大本营
   */
  setupBase(position: { q: number; r: number; s: number }) {
    if (!this.room) {
      console.error('未连接到房间');
      return;
    }
    this.room.send('setupBase', position);
  }

  /**
   * 部署单位
   */
  deployUnit(data: any) {
    if (!this.room) return;
    this.room.send('deployUnit', data);
  }

  /**
   * 完成部署
   */
  finishDeploy() {
    if (!this.room) return;
    this.room.send('finishDeploy', {});
  }

  /**
   * 投骰子
   */
  rollDice() {
    if (!this.room) return;
    this.room.send('rollDice', {});
  }

  /**
   * 重投骰子
   */
  rerollDice(diceIndex: number) {
    if (!this.room) return;
    this.room.send('rerollDice', { diceIndex });
  }

  /**
   * 移动单位
   */
  moveUnit(unitId: string, to: { q: number; r: number; s: number }) {
    if (!this.room) return;
    this.room.send('moveUnit', {
      unitId,
      toQ: to.q,
      toR: to.r,
      toS: to.s,
    });
  }

  /**
   * 攻击单位
   */
  attackUnit(attackerId: string, targetId: string) {
    if (!this.room) return;
    this.room.send('attackUnit', { attackerId, targetId });
  }

  /**
   * 弩车贯穿攻击
   */
  ballistaPierceAttack(ballistaId: string) {
    if (!this.room) return;
    this.room.send('ballistaPierceAttack', { ballistaId });
  }

  /**
   * 弩车近战攻击
   */
  ballistaMeleeAttack(ballistaId: string, targetId: string) {
    if (!this.room) return;
    this.room.send('ballistaMeleeAttack', { ballistaId, targetId });
  }

  /**
   * 旋转单位
   */
  rotateUnit(unitId: string, direction: number) {
    if (!this.room) return;
    this.room.send('rotateUnit', { unitId, direction });
  }

  /**
   * 结束回合
   */
  endTurn() {
    if (!this.room) return;
    this.room.send('endTurn', {});
  }

  // ==================== 无双将军扇形攻击 API ====================

  /**
   * 开始扇形攻击
   */
  wushuangFanAttackStart() {
    if (!this.room) return;
    this.room.send('wushuangFanAttackStart', {});
  }

  /**
   * 选择攻击方向
   */
  wushuangSelectDirection(direction: number) {
    if (!this.room) return;
    this.room.send('wushuangSelectDirection', { direction });
  }

  /**
   * 执行攻击
   */
  wushuangExecuteAttack() {
    if (!this.room) return;
    this.room.send('wushuangExecuteAttack', {});
  }

  /**
   * 第二阶段掷骰
   */
  wushuangSecondRoll() {
    if (!this.room) return;
    this.room.send('wushuangSecondRoll', {});
  }

  /**
   * 第三阶段掷骰
   */
  wushuangThirdRoll() {
    if (!this.room) return;
    this.room.send('wushuangThirdRoll', {});
  }

  /**
   * 取消扇形攻击
   */
  wushuangCancel() {
    if (!this.room) return;
    this.room.send('wushuangCancel', {});
  }

  /**
   * 无双一次性技能：获得已损失体力值的行动次数
   */
  wushuangAbility() {
    if (!this.room) return;
    this.room.send('wushuangAbility', {});
  }

  // ==================== 神机将军技能 API ====================

  /**
   * 神机将军部署机关单位
   */
  shenjiDeployMachine(machineType: 'ballista' | 'chariot' | 'catapult', position: { q: number; r: number; s: number }) {
    if (!this.room) return;
    this.room.send('shenjiDeployMachine', { machineType, position });
  }

  /**
   * 投石车蓄力
   */
  catapultCharge(unitId: string) {
    if (!this.room) return;
    this.room.send('catapultCharge', { catapultId: unitId });
  }

  /**
   * 神机将军修改骰子点数
   */
  shenjiModifyDice(diceIndex: number, newValue: number) {
    if (!this.room) return;
    this.room.send('shenjiModifyDice', { diceIndex, newValue });
  }

  // ==================== 仁德将军技能 API ====================

  /**
   * 仁德将军转化接触单位为中立标记
   */
  rendeConvertAdjacent() {
    if (!this.room) return;
    this.room.send('rendeConvertAdjacent', {});
  }

  /**
   * 仁德将军转化中立标记为步兵
   */
  rendeConvertToInfantry(targetId: string) {
    if (!this.room) return;
    this.room.send('rendeConvertToInfantry', { targetId });
  }

  /**
   * 仁德将军击杀确认：直接击杀
   */
  rendeCompleteKill(targetId: string) {
    if (!this.room) return;
    this.room.send('rendeCompleteKill', { targetId });
  }

  /**
   * 仁德将军击杀确认：转为中立标记
   */
  rendeSpareAsNeutral(targetId: string) {
    if (!this.room) return;
    this.room.send('rendeSpareAsNeutral', { targetId });
  }

  // ==================== 太平将军 ====================

  /** 符水粥：救济一名相邻平民，天命 +1 */
  taipingFushui(civilianId: string) {
    if (!this.room) return;
    this.room.send('taipingFushui', { civilianId });
  }

  /** 豆饭：征募一名平民为黄巾力士（强制阶段，顺序由玩家定） */
  taipingRecruit(civilianId: string) {
    if (!this.room) return;
    this.room.send('taipingRecruit', { civilianId });
  }

  /** 腐化：让一只充能黄巾贼腐化一名相邻平民 */
  taipingCorrupt(zeiId: string, civilianId: string) {
    if (!this.room) return;
    this.room.send('taipingCorrupt', { zeiId, civilianId });
  }

  /** 宣告黄天当立 */
  taipingDeclareHuangtian() {
    if (!this.room) return;
    this.room.send('taipingDeclareHuangtian', {});
  }

  /**
   * 认输
   */
  surrender() {
    if (!this.room) return;
    this.room.send('surrender', {});
  }

  /**
   * 离开房间
   */
  leaveRoom() {
    if (this.room) {
      this.room.leave();
      this.room = null;
      this.myPlayerRole = null;
      // 清空击杀检测基线，否则下一局第一次同步会把整局单位当成「消失」
      this.previousUnitIds = new Set();
      validActions.clear();
    }
  }
}

// 导出单例
export const colyseusService = new ColyseusService();
