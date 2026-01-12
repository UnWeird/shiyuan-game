import { useState } from 'react';
import { useGameStore } from './stores/gameStore';
import { GamePhase } from './types';
import { GeneralSelect } from './components/Game/GeneralSelect';
import { ArmyBuild } from './components/Game/ArmyBuild';
import { BaseSetup } from './components/Game/BaseSetup';
import { GameBoard } from './components/Game/GameBoard';
import RoomLobby from './components/Game/RoomLobby';

function App() {
  const { phase, isOnlineMode } = useGameStore();
  const [showLobby, setShowLobby] = useState(false);
  const [showModeSelect, setShowModeSelect] = useState(true);

  // 模式选择界面
  if (showModeSelect) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 to-blue-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-2xl p-8 max-w-md w-full">
          <h1 className="text-5xl font-bold text-center mb-2 text-gray-800">
            十元
          </h1>
          <p className="text-center text-gray-600 mb-8">十元棋在线版</p>

          <div className="space-y-4">
            <button
              onClick={() => {
                useGameStore.setState({ isOnlineMode: true });
                setShowModeSelect(false);
                setShowLobby(true);
              }}
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-bold py-6 px-6 rounded-lg transition duration-200 transform hover:scale-105"
            >
              <div className="text-2xl mb-1">🌐 在线对战</div>
              <div className="text-sm opacity-90">与好友实时对战</div>
            </button>

            <button
              onClick={() => {
                useGameStore.setState({ isOnlineMode: false });
                setShowModeSelect(false);
              }}
              className="w-full bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white font-bold py-6 px-6 rounded-lg transition duration-200 transform hover:scale-105"
            >
              <div className="text-2xl mb-1">🎮 单机模式</div>
              <div className="text-sm opacity-90">在同一设备上轮流游戏</div>
            </button>
          </div>

          <p className="text-center text-gray-500 text-xs mt-6">
            v1.0.0 - Powered by Colyseus
          </p>
        </div>
      </div>
    );
  }

  // 如果是在线模式但还没加入房间，显示大厅
  if (isOnlineMode && showLobby) {
    return <RoomLobby onRoomJoined={() => setShowLobby(false)} />;
  }

  return (
    <div className="min-h-screen">
      {phase === GamePhase.GENERAL_SELECT && <GeneralSelect />}
      {phase === GamePhase.ARMY_BUILD && <ArmyBuild />}
      {phase === GamePhase.BASE_SETUP && <BaseSetup />}
      {(phase === GamePhase.DEPLOY || phase === GamePhase.ACTION) && <GameBoard />}
      {phase === GamePhase.END && (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 to-blue-50">
          <div className="bg-white rounded-lg shadow-xl p-8 text-center">
            <h1 className="text-4xl font-bold mb-4">游戏结束</h1>
            <button
              onClick={() => useGameStore.getState().resetGame()}
              className="px-6 py-3 bg-blue-500 text-white rounded-lg font-bold hover:bg-blue-600"
            >
              重新开始
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
