import { useState, useEffect } from 'react';
import { colyseusService } from '../../services/ColyseusService';
import { useGameStore } from '../../stores/gameStore';
import { toast } from '../../stores/uiStore';
import RulesModal from '../UI/RulesModal';

interface RoomLobbyProps {
  onRoomJoined: () => void;
}

/**
 * 装饰分割线。
 * 提到组件外面：定义在 render 里的话每次渲染都是一个新组件类型，
 * React 会把它整棵子树卸载重建（eslint react-hooks/static-components 报的就是这个）。
 */
const Divider = () => (
  <div className="flex items-center justify-center gap-3 my-4">
    <div className="h-px w-16 bg-gradient-to-r from-transparent to-imperial-gold/30" />
    <div className="w-1.5 h-1.5 rotate-45 bg-imperial-gold/30" />
    <div className="h-px w-16 bg-gradient-to-l from-transparent to-imperial-gold/30" />
  </div>
);

export default function RoomLobby({ onRoomJoined }: RoomLobbyProps) {
  const [mode, setMode] = useState<'menu' | 'create' | 'join' | 'spectate'>('menu');
  const [roomId, setRoomId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [waitingForOpponent, setWaitingForOpponent] = useState(false);
  const [opponentJoined, setOpponentJoined] = useState(false);
  const [isSpectator, setIsSpectator] = useState(false);
  const phase = useGameStore(state => state.phase);
  const isRulesModalOpen = useGameStore(state => state.isRulesModalOpen);
  const setRulesModalOpen = useGameStore(state => state.setRulesModalOpen);

  // 监听游戏开始消息（当对手加入时服务器会发送）
  useEffect(() => {
    if (!waitingForOpponent) return;

    const room = colyseusService['room'];
    if (!room) return;

    const handleGameStart = () => {
      console.log('🎮 收到 gameStart 消息，对手已加入！');
      setOpponentJoined(true);
      // 延迟一下让用户看到状态变化
      setTimeout(() => {
        onRoomJoined();
      }, 1500);
    };

    room.onMessage('gameStart', handleGameStart);

    // Colyseus doesn't need explicit cleanup for onMessage handlers
  }, [waitingForOpponent, onRoomJoined]);

  const handleCreateRoom = async () => {
    setLoading(true);
    setError('');
    try {
      const newRoomId = await colyseusService.createRoom();
      setRoomId(newRoomId);
      setMode('create');
      setLoading(false);
      setWaitingForOpponent(true);
    } catch (err: any) {
      setError(err.message || '创建房间失败');
      setLoading(false);
    }
  };

  const handleJoinRoom = async () => {
    if (!roomId.trim()) {
      setError('请输入房间ID');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await colyseusService.joinRoom(roomId.trim(), isSpectator);
      onRoomJoined();
    } catch (err: any) {
      setError(err.message || '加入房间失败');
      setLoading(false);
    }
  };

  // 古风面板样式
  const bgStyle = { background: 'radial-gradient(ellipse at 50% 30%, #2a0a00 0%, #0d0500 50%, #050200 100%)' };
  const panelStyle = {
    background: 'linear-gradient(180deg, rgba(26,10,0,0.95) 0%, rgba(13,5,0,0.98) 100%)',
    border: '1px solid rgba(201,162,39,0.3)',
    boxShadow: '0 0 60px rgba(201,162,39,0.12), inset 0 1px 0 rgba(201,162,39,0.15)',
  };

  const lobbyBtn = (active = true) => ({
    border: active ? '1px solid rgba(201,162,39,0.5)' : '1px solid rgba(201,162,39,0.2)',
    color: active ? '#E8C84A' : 'rgba(201,162,39,0.35)',
    background: active ? 'linear-gradient(135deg, rgba(80,20,20,0.4) 0%, rgba(26,10,0,0.8) 100%)' : 'rgba(13,5,0,0.5)',
    cursor: active ? 'pointer' : 'not-allowed',
    transition: 'all 0.25s',
  });

  if (mode === 'menu') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden" style={bgStyle}>
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 40px, rgba(201,162,39,0.15) 40px, rgba(201,162,39,0.15) 41px), repeating-linear-gradient(90deg, transparent, transparent 40px, rgba(201,162,39,0.15) 40px, rgba(201,162,39,0.15) 41px)'
        }} />
        {/* 四角装饰 */}
        <div className="absolute top-4 left-4 w-14 h-14 border-t-2 border-l-2 border-imperial-gold opacity-30" />
        <div className="absolute top-4 right-4 w-14 h-14 border-t-2 border-r-2 border-imperial-gold opacity-30" />
        <div className="absolute bottom-4 left-4 w-14 h-14 border-b-2 border-l-2 border-imperial-gold opacity-30" />
        <div className="absolute bottom-4 right-4 w-14 h-14 border-b-2 border-r-2 border-imperial-gold opacity-30" />

        <div className="relative z-10 max-w-sm w-full rounded-lg p-8 page-enter" style={panelStyle as React.CSSProperties}>
          <h1 className="font-ancient text-5xl text-center mb-1 tracking-widest" style={{ color: '#C9A227', textShadow: '0 0 25px rgba(201,162,39,0.5)' }}>
            十元
          </h1>
          <p className="font-chinese text-center text-xs tracking-[0.3em] mb-1" style={{ color: 'rgba(201,162,39,0.5)' }}>联网对战大厅</p>
          <Divider />

          {error && (
            <div className="mb-4 px-4 py-2 rounded font-chinese text-sm" style={{ border: '1px solid rgba(220,60,60,0.4)', color: '#ef9999', background: 'rgba(80,10,10,0.4)' }}>
              {error}
            </div>
          )}

          <div className="space-y-3">
            {[
              { label: loading ? '创建中...' : '创建房间', onClick: handleCreateRoom, disabled: loading },
              { label: '加入对战', onClick: () => { setMode('join'); setIsSpectator(false); }, disabled: loading },
              { label: '观战房间', onClick: () => { setMode('spectate'); setIsSpectator(true); }, disabled: loading },
              { label: '返回', onClick: () => window.location.href = '/', disabled: false },
            ].map(({ label, onClick, disabled }) => (
              <button
                key={label}
                onClick={onClick}
                disabled={disabled}
                className="w-full py-3 px-6 rounded font-chinese tracking-widest"
                style={lobbyBtn(!disabled) as React.CSSProperties}
                onMouseEnter={e => !disabled && ((e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 18px rgba(201,162,39,0.25)')}
                onMouseLeave={e => !disabled && ((e.currentTarget as HTMLButtonElement).style.boxShadow = 'none')}
              >
                {label}
              </button>
            ))}
            <button
              onClick={() => setRulesModalOpen(true)}
              className="w-full py-2.5 px-6 rounded font-chinese text-sm tracking-widest"
              style={{ border: '1px solid rgba(201,162,39,0.2)', color: 'rgba(201,162,39,0.5)', background: 'transparent', transition: 'all 0.25s' }}
              onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = 'rgba(201,162,39,0.8)')}
              onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = 'rgba(201,162,39,0.5)')}
            >
              查看规则
            </button>
          </div>

          <p className="font-chinese text-center text-xs mt-6" style={{ color: 'rgba(201,162,39,0.25)' }}>
            创建房间后将 ID 分享给好友
          </p>
        </div>

        <RulesModal isOpen={isRulesModalOpen} onClose={() => setRulesModalOpen(false)} />
      </div>
    );
  }

  if (mode === 'join' || mode === 'spectate') {
    const canJoin = !loading && !!roomId.trim();
    return (
      <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden" style={bgStyle}>
        <div className="relative z-10 max-w-sm w-full rounded-lg p-8 page-enter" style={panelStyle as React.CSSProperties}>
          <h2 className="font-ancient text-3xl text-center tracking-[0.3em] mb-1" style={{ color: '#C9A227', textShadow: '0 0 20px rgba(201,162,39,0.4)' }}>
            {mode === 'spectate' ? '观战入场' : '加入对局'}
          </h2>
          <Divider />

          {error && (
            <div className="mb-4 px-4 py-2 rounded font-chinese text-sm" style={{ border: '1px solid rgba(220,60,60,0.4)', color: '#ef9999', background: 'rgba(80,10,10,0.4)' }}>
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="font-chinese text-xs tracking-widest mb-2 block" style={{ color: 'rgba(201,162,39,0.6)' }}>房间令牌</label>
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="输入房间 ID"
                className="w-full px-4 py-3 rounded font-chinese text-sm"
                style={{
                  background: 'rgba(13,5,0,0.8)',
                  border: '1px solid rgba(201,162,39,0.3)',
                  color: '#E8C84A',
                  caretColor: '#C9A227',
                }}
                disabled={loading}
              />
            </div>

            {mode === 'spectate' && (
              <p className="font-chinese text-xs px-3 py-2 rounded" style={{ border: '1px solid rgba(201,162,39,0.15)', color: 'rgba(245,230,200,0.5)', background: 'rgba(13,5,0,0.4)' }}>
                以观战者身份入场，可观看对局但不可操作
              </p>
            )}

            <button
              onClick={handleJoinRoom}
              disabled={!canJoin}
              className="w-full py-3 px-6 rounded font-chinese tracking-widest"
              style={lobbyBtn(canJoin) as React.CSSProperties}
              onMouseEnter={e => canJoin && ((e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 20px rgba(201,162,39,0.3)')}
              onMouseLeave={e => canJoin && ((e.currentTarget as HTMLButtonElement).style.boxShadow = 'none')}
            >
              {loading ? '加入中...' : (mode === 'spectate' ? '进入观战' : '进入对局')}
            </button>

            <button
              onClick={() => { setMode('menu'); setError(''); setRoomId(''); setIsSpectator(false); }}
              disabled={loading}
              className="w-full py-2.5 px-6 rounded font-chinese text-sm tracking-widest"
              style={{ border: '1px solid rgba(201,162,39,0.2)', color: 'rgba(201,162,39,0.5)', background: 'transparent' }}
            >
              返回
            </button>
          </div>
        </div>
      </div>
    );
  }

  // mode === 'create' - 等待对手
  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden" style={bgStyle}>
      <div className="relative z-10 max-w-sm w-full rounded-lg p-8 page-enter" style={panelStyle as React.CSSProperties}>
        <h2 className="font-ancient text-3xl text-center tracking-[0.3em] mb-1"
          style={{ color: opponentJoined ? '#4ade80' : '#C9A227', textShadow: opponentJoined ? '0 0 20px rgba(74,222,128,0.4)' : '0 0 20px rgba(201,162,39,0.4)' }}
        >
          {opponentJoined ? '对手已入场' : '恭候对手'}
        </h2>
        <Divider />

        {/* 房间 ID 展示 */}
        <div className="mb-6 rounded p-5 text-center" style={{ border: '1px solid rgba(201,162,39,0.25)', background: 'rgba(13,5,0,0.6)' }}>
          <p className="font-chinese text-xs tracking-widest mb-2" style={{ color: 'rgba(201,162,39,0.5)' }}>房间令牌</p>
          <p className="font-ancient text-2xl tracking-widest break-all" style={{ color: '#E8C84A' }}>{roomId}</p>
          <button
            onClick={() => {
              const fallbackCopy = (text: string) => {
                const el = document.createElement('textarea');
                el.value = text;
                el.style.position = 'fixed';
                el.style.left = '-999999px';
                document.body.appendChild(el);
                el.focus();
                el.select();
                try { document.execCommand('copy'); toast.success('已复制到剪贴板'); } catch { toast.warn(`请手动复制：${text}`); }
                document.body.removeChild(el);
              };
              if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(roomId).then(() => toast.success('已复制到剪贴板')).catch(() => fallbackCopy(roomId));
              } else {
                fallbackCopy(roomId);
              }
            }}
            className="mt-3 px-5 py-1.5 rounded font-chinese text-xs tracking-widest transition-all duration-200"
            style={{ border: '1px solid rgba(201,162,39,0.4)', color: '#C9A227', background: 'rgba(13,5,0,0.7)' }}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(201,162,39,0.8)')}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(201,162,39,0.4)')}
          >
            复制令牌
          </button>
        </div>

        {!opponentJoined ? (
          <div className="text-center">
            {/* 等待动画：呼吸旋转菱形 */}
            <div className="flex justify-center mb-4">
              <div className="w-8 h-8 imperial-spin"
                style={{ border: '2px solid transparent', borderTopColor: 'rgba(201,162,39,0.8)', borderRightColor: 'rgba(201,162,39,0.25)', transform: 'rotate(45deg)' }}
              />
            </div>
            <p className="font-chinese text-sm tracking-wider gold-breathe" style={{ color: 'rgba(245,230,200,0.6)' }}>
              将令牌分享给好友，对手加入后自动开始
            </p>
          </div>
        ) : (
          <p className="font-chinese text-sm text-center tracking-wider" style={{ color: 'rgba(100,200,100,0.8)' }}>
            对手已入场，即将开始对局...
          </p>
        )}
      </div>
    </div>
  );
}
