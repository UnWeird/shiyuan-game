import React, { useState, useEffect } from 'react';
import { Player, HexCoord } from '../../types';
import { useGameStore } from '../../stores/gameStore';
import { HexMap } from '../Map/HexMap';
import { isInStartZone } from '../../utils/hexUtils';
import { colyseusService } from '../../services/ColyseusService';

export const BaseSetup: React.FC = () => {
  const {
    currentPlayer,
    player1Base,
    player2Base,
    setBase,
    nextPhase,
    isOnlineMode,
    myPlayerRole,
  } = useGameStore();

  const [tempBase, setTempBase] = useState<HexCoord | null>(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  // 获取我的大本营和对手的大本营
  const myBase = isOnlineMode && myPlayerRole
    ? (myPlayerRole === 'player1' ? player1Base : player2Base)
    : (currentPlayer === Player.PLAYER1 ? player1Base : player2Base);

  const opponentBase = isOnlineMode && myPlayerRole
    ? (myPlayerRole === 'player1' ? player2Base : player1Base)
    : null;

  // 判断我应该放置在哪个区域
  const myZone = isOnlineMode && myPlayerRole
    ? (myPlayerRole === 'player1' ? 'top' : 'bottom')
    : (currentPlayer === Player.PLAYER1 ? 'top' : 'bottom');

  // 加载已有的大本营位置
  useEffect(() => {
    if (myBase) {
      setTempBase(myBase);
      setHasSubmitted(true);
    }
  }, [myBase]);

  const handleHexClick = (hex: HexCoord) => {
    // 已提交后不能再修改
    if (hasSubmitted) return;

    // 检查是否在自己的起始区
    const isValidZone = isInStartZone(hex, myZone);

    if (isValidZone) {
      setTempBase(hex);
    }
  };

  const handleConfirm = () => {
    if (tempBase) {
      if (isOnlineMode) {
        // 在线模式：发送给服务器
        colyseusService.setupBase(tempBase);
        setHasSubmitted(true);
      } else {
        // 单机模式：原有逻辑
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
    }
  };

  const displayBase = tempBase || myBase;
  const highlightedHexes = displayBase ? [displayBase] : [];

  // 判断对手是否已设置
  const opponentDone = opponentBase !== null;
  const waitingForOpponent = isOnlineMode && hasSubmitted && !opponentDone;

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-blue-50 flex flex-col items-center justify-center p-8">
      <div className="max-w-6xl w-full">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">设置大本营</h1>
          <p className="text-xl text-gray-600">
            {isOnlineMode
              ? `${myPlayerRole === 'player1' ? '玩家 1' : '玩家 2'} (你) 请在你的起始区（${myZone === 'top' ? '黄色区域' : '蓝色区域'}）选择大本营位置`
              : `${currentPlayer === Player.PLAYER1 ? '玩家 1' : '玩家 2'} 请在你的起始区（${currentPlayer === Player.PLAYER1 ? '黄色区域' : '蓝色区域'}）选择大本营位置`
            }
          </p>
          <p className="text-sm text-gray-500 mt-2">
            胜利条件：敌方单位触碰到大本营
          </p>
          {isOnlineMode && (
            <p className="text-sm text-gray-500 mt-1">
              对手设置状态: {opponentDone ? '✅ 已完成' : '⏳ 设置中...'}
            </p>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-xl p-4 mb-6" style={{ height: '600px' }}>
          <HexMap
            radius={5}
            hexSize={40}
            onHexClick={handleHexClick}
            highlightedHexes={highlightedHexes}
          />
        </div>

        <div className="flex flex-col items-center gap-4">
          {waitingForOpponent && (
            <div className="text-center">
              <div className="flex justify-center mb-4">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
              </div>
              <p className="text-blue-600 font-semibold">
                ✅ 你的大本营位置已设置！等待对手完成设置...
              </p>
            </div>
          )}
          {hasSubmitted && opponentDone && (
            <p className="text-green-600 font-semibold">
              ✅ 双方大本营设置完成！即将进入部署阶段...
            </p>
          )}
          <button
            onClick={handleConfirm}
            disabled={!tempBase || hasSubmitted}
            className={`
              px-8 py-3 rounded-lg font-bold text-lg transition-all duration-200
              ${tempBase && !hasSubmitted
                ? 'bg-green-500 text-white hover:bg-green-600 shadow-lg'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }
            `}
          >
            {isOnlineMode
              ? (hasSubmitted ? '已设置位置' : '确认位置')
              : (currentPlayer === Player.PLAYER1 ? '确认位置（玩家2设置）' : '确认位置（开始游戏）')
            }
          </button>
        </div>
      </div>
    </div>
  );
};
