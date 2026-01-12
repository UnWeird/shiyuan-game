import { useState, useEffect } from 'react';
import { colyseusService } from '../../services/ColyseusService';
import { useGameStore } from '../../stores/gameStore';

interface RoomLobbyProps {
  onRoomJoined: () => void;
}

export default function RoomLobby({ onRoomJoined }: RoomLobbyProps) {
  const [mode, setMode] = useState<'menu' | 'create' | 'join' | 'spectate'>('menu');
  const [roomId, setRoomId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [waitingForOpponent, setWaitingForOpponent] = useState(false);
  const [opponentJoined, setOpponentJoined] = useState(false);
  const [isSpectator, setIsSpectator] = useState(false);
  const phase = useGameStore(state => state.phase);

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

  if (mode === 'menu') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 to-purple-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-2xl p-8 max-w-md w-full">
          <h1 className="text-4xl font-bold text-center mb-2 text-gray-800">
            十元
          </h1>
          <p className="text-center text-gray-600 mb-8">在线多人对战</p>

          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <button
              onClick={handleCreateRoom}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-6 rounded-lg transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '创建中...' : '创建房间'}
            </button>

            <button
              onClick={() => {
                setMode('join');
                setIsSpectator(false);
              }}
              disabled={loading}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-6 rounded-lg transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              加入对战
            </button>

            <button
              onClick={() => {
                setMode('spectate');
                setIsSpectator(true);
              }}
              disabled={loading}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-4 px-6 rounded-lg transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              观战房间
            </button>

            <button
              onClick={() => window.location.href = '/'}
              className="w-full bg-gray-600 hover:bg-gray-700 text-white font-bold py-4 px-6 rounded-lg transition duration-200"
            >
              单机模式
            </button>
          </div>

          <p className="text-center text-gray-500 text-sm mt-6">
            创建房间后，将房间ID分享给好友即可一起游戏
          </p>
        </div>
      </div>
    );
  }

  if (mode === 'join' || mode === 'spectate') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 to-purple-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-2xl p-8 max-w-md w-full">
          <h2 className="text-3xl font-bold text-center mb-6 text-gray-800">
            {mode === 'spectate' ? '观战房间' : '加入房间'}
          </h2>

          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-gray-700 text-sm font-bold mb-2">
                房间 ID
              </label>
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="输入房间ID"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                disabled={loading}
              />
            </div>

            {mode === 'spectate' && (
              <div className="bg-purple-50 border-2 border-purple-300 rounded-lg p-4">
                <p className="text-purple-800 text-sm">
                  你将以<span className="font-bold">观战者</span>身份加入，可以观看对局但不能操作
                </p>
              </div>
            )}

            <button
              onClick={handleJoinRoom}
              disabled={loading || !roomId.trim()}
              className={`w-full ${mode === 'spectate' ? 'bg-purple-600 hover:bg-purple-700' : 'bg-green-600 hover:bg-green-700'} text-white font-bold py-4 px-6 rounded-lg transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {loading ? '加入中...' : (mode === 'spectate' ? '观战' : '加入游戏')}
            </button>

            <button
              onClick={() => {
                setMode('menu');
                setError('');
                setRoomId('');
                setIsSpectator(false);
              }}
              disabled={loading}
              className="w-full bg-gray-600 hover:bg-gray-700 text-white font-bold py-4 px-6 rounded-lg transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              返回
            </button>
          </div>
        </div>
      </div>
    );
  }

  // mode === 'create' - 显示等待对手
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 to-purple-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl p-8 max-w-md w-full">
        <h2 className="text-3xl font-bold text-center mb-6 text-gray-800">
          {opponentJoined ? '✅ 对手已加入！' : '等待对手加入'}
        </h2>

        <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-6 mb-6">
          <p className="text-gray-700 text-center mb-2 font-semibold">
            房间 ID
          </p>
          <p className="text-3xl font-mono text-center text-blue-600 font-bold tracking-wider break-all">
            {roomId}
          </p>
          <button
            onClick={() => {
              navigator.clipboard.writeText(roomId);
              alert('房间ID已复制到剪贴板！');
            }}
            className="w-full mt-4 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition duration-200"
          >
            复制房间ID
          </button>
        </div>

        {!opponentJoined && (
          <>
            <div className="flex justify-center mb-6">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>

            <p className="text-center text-gray-600">
              将房间ID分享给你的朋友
            </p>
            <p className="text-center text-gray-500 text-sm mt-2">
              对手加入后游戏将自动开始
            </p>
          </>
        )}

        {opponentJoined && (
          <div className="text-center">
            <div className="bg-green-100 border border-green-400 rounded-lg p-4 mb-4">
              <p className="text-green-800 font-semibold">
                🎉 对手已加入房间！
              </p>
              <p className="text-green-700 text-sm mt-1">
                即将开始游戏...
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
