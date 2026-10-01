import { useState } from 'react';
import { useGameStore } from './stores/gameStore';
import { useUIStore, toast } from './stores/uiStore';
import { colyseusService } from './services/ColyseusService';
import { GamePhase } from './types';
import { GeneralSelect } from './components/Game/GeneralSelect';
import { ArmyBuild } from './components/Game/ArmyBuild';
import { BaseSetup } from './components/Game/BaseSetup';
import { GameBoard } from './components/Game/GameBoard';
import RoomLobby from './components/Game/RoomLobby';
import RulesModal from './components/UI/RulesModal';
import ToastContainer from './components/UI/ToastContainer';
import ConfirmDialog from './components/UI/ConfirmDialog';
import GameOverOverlay from './components/UI/GameOverOverlay';
import DevPanel from './dev/DevPanel';

function App() {
  const { phase, isOnlineMode, isRulesModalOpen, setRulesModalOpen } = useGameStore();
  const [showLobby, setShowLobby] = useState(false);
  const [showModeSelect, setShowModeSelect] = useState(true);
  const clearGameOver = useUIStore(state => state.clearGameOver);
  const [hotseatLoading, setHotseatLoading] = useState(false);

  /**
   * 同机对弈：创建一个 hotseat 房间，由服务端裁决双方。
   *
   * 以前这里是纯本地流程，规则走客户端自己那套引擎 —— 那份实现会和服务端漂移
   * （例如无双将军解除行动限制后，客户端算不出可移动格）。
   * 现在单机也走服务端，全项目只有一份规则。
   */
  const handleStartHotseat = async () => {
    setHotseatLoading(true);
    try {
      await colyseusService.createRoom({ hotseat: true });
      useGameStore.setState({ isOnlineMode: true, isHotseat: true });
      setShowLobby(false);
      setShowModeSelect(false);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : '无法连接服务器',
        '同机对弈需要服务端在运行'
      );
    } finally {
      setHotseatLoading(false);
    }
  };

  /** 结算后重开：离开房间、清空对局与结算状态、回到模式选择 */
  const handleRestart = () => {
    if (isOnlineMode) colyseusService.leaveRoom();
    clearGameOver();
    useGameStore.getState().resetGame();
    setShowLobby(false);
    setShowModeSelect(true);
  };

  // 页面主体（模式选择 / 大厅 / 对局），全局浮层在最外层统一挂载
  const renderContent = () => {
    // 模式选择界面
    if (showModeSelect) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden page-enter"
          style={{ background: 'radial-gradient(ellipse at 50% 30%, #2a0a00 0%, #0d0500 50%, #050200 100%)' }}
        >
          {/* 背景装饰纹样 */}
          <div className="absolute inset-0 opacity-10" style={{
            backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 40px, rgba(201,162,39,0.15) 40px, rgba(201,162,39,0.15) 41px), repeating-linear-gradient(90deg, transparent, transparent 40px, rgba(201,162,39,0.15) 40px, rgba(201,162,39,0.15) 41px)'
          }} />
          {/* 四角装饰 */}
          <div className="absolute top-4 left-4 w-16 h-16 border-t-2 border-l-2 border-imperial-gold opacity-40" />
          <div className="absolute top-4 right-4 w-16 h-16 border-t-2 border-r-2 border-imperial-gold opacity-40" />
          <div className="absolute bottom-4 left-4 w-16 h-16 border-b-2 border-l-2 border-imperial-gold opacity-40" />
          <div className="absolute bottom-4 right-4 w-16 h-16 border-b-2 border-r-2 border-imperial-gold opacity-40" />

          <div className="relative z-10 max-w-sm w-full">
            {/* 面板主体 */}
            <div className="rounded-lg p-8 border border-imperial-gold/30"
              style={{ background: 'linear-gradient(180deg, rgba(26,10,0,0.95) 0%, rgba(13,5,0,0.98) 100%)', boxShadow: '0 0 60px rgba(201,162,39,0.15), inset 0 1px 0 rgba(201,162,39,0.2)' }}
            >
              {/* 顶部装饰线 */}
              <div className="flex items-center gap-3 mb-6">
                <div className="flex-1 h-px bg-gradient-to-r from-transparent to-imperial-gold/60" />
                <div className="w-2 h-2 rotate-45 bg-imperial-gold/60" />
                <div className="flex-1 h-px bg-gradient-to-l from-transparent to-imperial-gold/60" />
              </div>

              {/* 标题 */}
              <h1 className="font-ancient text-7xl font-normal text-center mb-1 tracking-widest"
                style={{ color: '#C9A227', textShadow: '0 0 30px rgba(201,162,39,0.6), 0 0 60px rgba(201,162,39,0.2)' }}
              >
                十元
              </h1>
              <p className="font-chinese text-center text-imperial-gold/60 mb-2 tracking-[0.3em] text-sm">十元棋 · 策略对弈</p>

              {/* 分割线 */}
              <div className="flex items-center gap-3 mb-8">
                <div className="flex-1 h-px bg-gradient-to-r from-transparent to-imperial-gold/40" />
                <div className="w-1.5 h-1.5 rotate-45 bg-imperial-gold/40" />
                <div className="flex-1 h-px bg-gradient-to-l from-transparent to-imperial-gold/40" />
              </div>

              <div className="space-y-3">
                <button
                  onClick={() => {
                    useGameStore.setState({ isOnlineMode: true });
                    setShowModeSelect(false);
                    setShowLobby(true);
                  }}
                  className="w-full py-4 px-6 rounded border font-chinese font-medium transition-all duration-300 group relative overflow-hidden"
                  style={{ borderColor: 'rgba(201,162,39,0.5)', background: 'linear-gradient(135deg, rgba(139,26,26,0.4) 0%, rgba(26,10,0,0.8) 100%)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(201,162,39,0.9)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 20px rgba(201,162,39,0.3)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(201,162,39,0.5)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none'; }}
                >
                  <div className="text-lg tracking-widest" style={{ color: '#E8C84A' }}>联网对战</div>
                  <div className="text-xs mt-0.5 text-imperial-gold/50 tracking-wider">与好友实时对弈</div>
                </button>

                <button
                  onClick={handleStartHotseat}
                  disabled={hotseatLoading}
                  className="w-full py-4 px-6 rounded border font-chinese font-medium transition-all duration-300"
                  style={{ borderColor: 'rgba(201,162,39,0.3)', background: 'linear-gradient(135deg, rgba(26,26,26,0.4) 0%, rgba(13,5,0,0.8) 100%)', opacity: hotseatLoading ? 0.6 : 1 }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(201,162,39,0.7)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 15px rgba(201,162,39,0.2)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(201,162,39,0.3)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none'; }}
                >
                  <div className="text-lg tracking-widest" style={{ color: '#C9A227' }}>
                    {hotseatLoading ? '正在开局…' : '同机对弈'}
                  </div>
                  <div className="text-xs mt-0.5 text-imperial-gold/40 tracking-wider">在同一设备上轮流游戏</div>
                </button>
              </div>

              {/* 底部 */}
              <div className="flex items-center gap-3 mt-8">
                <div className="flex-1 h-px bg-gradient-to-r from-transparent to-imperial-gold/20" />
                <p className="text-imperial-gold/30 text-xs tracking-widest font-chinese">v1.0.0</p>
                <div className="flex-1 h-px bg-gradient-to-l from-transparent to-imperial-gold/20" />
              </div>
            </div>
          </div>
        </div>
      );
    }

    // 如果是在线模式但还没加入房间，显示大厅
    if (isOnlineMode && showLobby) {
      return <RoomLobby onRoomJoined={() => setShowLobby(false)} />;
    }

    return (
      <div className="min-h-screen page-enter" key={phase}>
        {phase === GamePhase.GENERAL_SELECT && <GeneralSelect />}
        {phase === GamePhase.ARMY_BUILD && <ArmyBuild />}
        {phase === GamePhase.BASE_SETUP && <BaseSetup />}
        {(phase === GamePhase.DEPLOY || phase === GamePhase.ACTION) && <GameBoard />}
        {phase === GamePhase.END && <GameOverOverlay onRestart={handleRestart} />}

        {/* 规则书模态 */}
        <RulesModal isOpen={isRulesModalOpen} onClose={() => setRulesModalOpen(false)} />
      </div>
    );
  };

  return (
    <>
      {renderContent()}
      {/* 全局浮层：任何界面都要能弹出提示与确认框 */}
      <ToastContainer />
      <ConfirmDialog />
      {/* 开发面板（Ctrl+Shift+D）：生产构建下这段会被 tree-shake */}
      {import.meta.env.DEV && <DevPanel />}
    </>
  );
}

export default App;
