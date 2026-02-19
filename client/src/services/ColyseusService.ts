import { Client, Room } from 'colyseus.js';
import { useGameStore } from '../stores/gameStore';
import { GeneralType, Player } from '../types';

/**
 * Colyseus 网络服务
 * 负责与服务器通信、房间管理、状态同步
 */
class ColyseusService {
  private client: Client;
  private room: Room | null = null;
  private myPlayerRole: 'player1' | 'player2' | 'spectator' | null = null;

  constructor() {
    // 连接到服务器（支持环境变量配置）
    const serverUrl = import.meta.env.VITE_SERVER_URL || 'ws://localhost:2567';
    this.client = new Client(serverUrl);
    console.log('🔗 连接到服务器:', serverUrl);
  }

  /**
   * 创建新房间
   */
  async createRoom(): Promise<string> {
    try {
      this.room = await this.client.create('shiyuan_room');
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
    }) => {
      this.myPlayerRole = data.role;
      console.log('👤 我的角色:', data.role, data);

      useGameStore.setState({
        isOnlineMode: true,
        myPlayerRole: data.role
      });

      // 接管或重连时弹出提示
      if (data.takenOver || data.reconnected) {
        const roleLabel = data.role === 'spectator' ? '观战者' : data.role;
        const actionLabel = data.takenOver ? '接管' : '重连';
        alert(
          `${actionLabel}成功！\n` +
          `你的角色：${roleLabel}\n` +
          `当前阶段：${data.gamePhase ?? '未知'}\n` +
          `当前行动方：${data.currentPlayer ?? '未知'}\n` +
          `可用行动点：${data.actionPoints ?? 0}`
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
    });

    // 监听错误消息
    this.room.onMessage('error', (data: { message: string }) => {
      console.error('❌ 服务器错误:', data.message);
      alert(`错误: ${data.message}`);
    });

    // 监听信息消息
    this.room.onMessage('info', (data: { message: string }) => {
      console.log('ℹ️  服务器信息:', data.message);
    });

    // 监听玩家离开（主动）
    this.room.onMessage('playerLeft', (data: { role: string; message: string }) => {
      console.log('👋 玩家离开:', data.message);
      alert(data.message);
    });

    // 监听玩家断线
    this.room.onMessage('playerDisconnected', (data: { role: string; message: string }) => {
      console.log('⚠️ 玩家断线:', data.message);
      alert(`提示：${data.message}`);
    });

    // 监听断线槽位已释放（60秒超时，可加入新玩家）
    this.room.onMessage('playerSlotOpen', (data: { role: string; message: string }) => {
      console.log('🔓 槽位释放:', data.message);
      alert(`提示：${data.message}`);
    });

    // 监听新玩家接管
    this.room.onMessage('playerTookOver', (data: { role: string; message: string }) => {
      console.log('🔄 玩家接管:', data.message);
      alert(`提示：${data.message}`);
    });

    // 监听玩家重连
    this.room.onMessage('playerReconnected', (data: { role: string; message: string }) => {
      console.log('✅ 玩家重连:', data.message);
      alert(`提示：${data.message}`);
    });

    // 监听游戏结束
    this.room.onMessage('gameEnd', (data: { winner: string; message: string }) => {
      console.log('🏆 游戏结束:', data.message);
      alert(`游戏结束！${data.message}`);
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

    // 监听状态变化（核心！）
    this.room.onStateChange((state) => {
      this.syncStateToStore(state);
    });

    // 监听房间错误
    this.room.onError((code, message) => {
      console.error('房间错误:', code, message);
      alert(`房间错误: ${message}`);
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
      alert('连接已断开，无法重连');
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
      alert('重连失败，请刷新页面重新加入');
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
          });
        }
      });
    }

    // 转换骰子结果
    const player1DiceResults = state.player1DiceResults ? Array.from(state.player1DiceResults) as number[] : [];
    const player2DiceResults = state.player2DiceResults ? Array.from(state.player2DiceResults) as number[] : [];

    // 转换扇形攻击状态
    const wushuangDiceRolls = state.wushuangDiceRolls ? Array.from(state.wushuangDiceRolls) as number[] : [];

    // 保存当前选中的单位ID（避免状态同步时清空选中）
    const currentSelectedUnitId = useGameStore.getState().selectedUnitId;

    // 更新 Zustand Store
    console.log(`[CLIENT DEBUG] 同步状态 - currentPlayer从服务器: ${state.currentPlayer}, 我的角色: ${this.myPlayerRole}`);
    useGameStore.setState({
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

      // 太平将军状态
      player1DestinyValue: state.player1DestinyValue || 0,
      player2DestinyValue: state.player2DestinyValue || 0,
      taipingFushuiActive: state.taipingFushuiActive || false,
      taipingFushuiPlayer: state.taipingFushuiPlayer || '',
      taipingTianmingActive: state.taipingTianmingActive || false,
      taipingTianmingPlayer: state.taipingTianmingPlayer || '',
      taipingTianmingCangtiandi: state.taipingTianmingCangtiandi || 0,
      taipingTianmingHuangtian: state.taipingTianmingHuangtian || 0,
      taipingTianmingDamage: state.taipingTianmingDamage || 0,
      // taipingTianmingOldDestiny：由 currentDestiny - huangtian + cangtiandi 派生
      taipingTianmingOldDestiny: (() => {
        const huangtian = state.taipingTianmingHuangtian || 0;
        const cangtiandi = state.taipingTianmingCangtiandi || 0;
        const destinyAfterRoll = state.taipingTianmingPlayer === 'player2'
          ? (state.player2DestinyValue || 0)
          : (state.player1DestinyValue || 0);
        return destinyAfterRoll - huangtian + cangtiandi;
      })(),
      // 双太平共享状态
      taipingSharedHp: state.taipingSharedHp ?? 3,
      // taipingSharedMaxHp：由将领配置派生（双太平=6，单太平=3）
      taipingSharedMaxHp: (state.player1General === 'taiping' && state.player2General === 'taiping') ? 6 : 3,
      player1DoufanUsedThisTurn: state.player1DoufanUsedThisTurn || false,
      player2DoufanUsedThisTurn: state.player2DoufanUsedThisTurn || false,
      player1TaipingDeployInitDone: state.player1TaipingDeployInitDone || false,
      player2TaipingDeployInitDone: state.player2TaipingDeployInitDone || false,
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

  // ==================== 太平将军技能 API ====================

  /**
   * 符水粥：转化一个残血步兵为力士
   */
  taipingFushuiConvert(unitId: string) {
    if (!this.room) return;
    this.room.send('taipingFushuiConvert', { unitId });
  }

  /**
   * 豆饭：召唤力士
   */
  taipingDoufan() {
    if (!this.room) return;
    this.room.send('taipingDoufan', {});
  }

  /**
   * 夺天命：结算天命骰（进入待确认状态）
   */
  taipingTianmingRoll() {
    if (!this.room) return;
    this.room.send('taipingTianmingRoll', {});
  }

  /**
   * 天命结算确认：看完结果后实际结束回合
   */
  taipingTianmingConfirm() {
    if (!this.room) return;
    this.room.send('taipingTianmingConfirm', {});
  }

  /**
   * 部署阶段天命初始化：苍天已死，黄天当立
   */
  taipingDeployInit() {
    if (!this.room) return;
    this.room.send('taipingDeployInit', {});
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
    }
  }
}

// 导出单例
export const colyseusService = new ColyseusService();
