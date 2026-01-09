import React from 'react';
import { useGameStore } from './stores/gameStore';
import { GamePhase } from './types';
import { GeneralSelect } from './components/Game/GeneralSelect';
import { ArmyBuild } from './components/Game/ArmyBuild';
import { BaseSetup } from './components/Game/BaseSetup';
import { GameBoard } from './components/Game/GameBoard';

function App() {
  const { phase } = useGameStore();

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
