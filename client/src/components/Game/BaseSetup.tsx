import React, { useState } from 'react';
import { Player, HexCoord } from '../../types';
import { useGameStore } from '../../stores/gameStore';
import { HexMap } from '../Map/HexMap';
import { isInStartZone } from '../../utils/hexUtils';

export const BaseSetup: React.FC = () => {
  const {
    currentPlayer,
    player1Base,
    player2Base,
    setBase,
    nextPhase,
  } = useGameStore();

  const [tempBase, setTempBase] = useState<HexCoord | null>(null);

  const handleHexClick = (hex: HexCoord) => {
    // 检查是否在自己的起始区
    const isValidZone = currentPlayer === Player.PLAYER1
      ? isInStartZone(hex, 'top')
      : isInStartZone(hex, 'bottom');

    if (isValidZone) {
      setTempBase(hex);
    }
  };

  const handleConfirm = () => {
    if (tempBase) {
      setBase(currentPlayer, tempBase);

      if (currentPlayer === Player.PLAYER1) {
        // 切换到玩家2设置大本营
        useGameStore.setState({ currentPlayer: Player.PLAYER2 });
        setTempBase(null);
      } else if (currentPlayer === Player.PLAYER2) {
        // 两个玩家都设置完了，重置为玩家1，进入部署阶段
        useGameStore.setState({ currentPlayer: Player.PLAYER1 });
        nextPhase();
      }
    }
  };

  const displayBase = currentPlayer === Player.PLAYER1
    ? (tempBase || player1Base)
    : (tempBase || player2Base);

  const highlightedHexes = displayBase ? [displayBase] : [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-blue-50 flex flex-col items-center justify-center p-8">
      <div className="max-w-6xl w-full">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">设置大本营</h1>
          <p className="text-xl text-gray-600">
            {currentPlayer === Player.PLAYER1 ? '玩家 1' : '玩家 2'} 请在你的起始区（{currentPlayer === Player.PLAYER1 ? '黄色区域' : '蓝色区域'}）选择大本营位置
          </p>
          <p className="text-sm text-gray-500 mt-2">
            胜利条件：敌方单位触碰到大本营
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-xl p-4 mb-6" style={{ height: '600px' }}>
          <HexMap
            radius={5}
            hexSize={40}
            onHexClick={handleHexClick}
            highlightedHexes={highlightedHexes}
          />
        </div>

        <div className="flex justify-center">
          <button
            onClick={handleConfirm}
            disabled={!tempBase}
            className={`
              px-8 py-3 rounded-lg font-bold text-lg transition-all duration-200
              ${tempBase
                ? 'bg-green-500 text-white hover:bg-green-600 shadow-lg'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }
            `}
          >
            {currentPlayer === Player.PLAYER1 ? '确认位置（玩家2设置）' : '确认位置（开始游戏）'}
          </button>
        </div>
      </div>
    </div>
  );
};
