import React, { useState, useEffect } from 'react';
import { Player } from '../../types';
import { useGameStore } from '../../stores/gameStore';

const UNIT_COSTS = {
  infantry: 0.1,  // 一角
  cavalry: 0.2,   // 两角
  archer: 0.5,    // 五角
};

const BUDGET = 4.0; // 4元预算

// 推荐配置
const RECOMMENDED_BUILDS = [
  {
    name: '平衡阵容',
    description: '步兵、骑兵、弓箭手均衡配置',
    infantry: 10,  // 1.0元
    cavalry: 5,    // 1.0元
    archer: 4,     // 2.0元
    // 总计: 1.0 + 1.0 + 2.0 = 4.0元
  },
  {
    name: '快攻流',
    description: '大量骑兵快速推进',
    infantry: 10,  // 1.0元
    cavalry: 10,   // 2.0元
    archer: 2,     // 1.0元
    // 总计: 1.0 + 2.0 + 1.0 = 4.0元
  },
  {
    name: '弓箭流',
    description: '远程压制为主',
    infantry: 15,  // 1.5元
    cavalry: 0,    // 0元
    archer: 5,     // 2.5元
    // 总计: 1.5 + 0 + 2.5 = 4.0元
  },
  {
    name: '步兵海',
    description: '大量步兵人海战术',
    infantry: 30,  // 3.0元
    cavalry: 0,    // 0元
    archer: 2,     // 1.0元
    // 总计: 3.0 + 0 + 1.0 = 4.0元
  },
];

export const ArmyBuild: React.FC = () => {
  const {
    currentPlayer,
    player1Army,
    player2Army,
    setArmy,
    nextPhase,
  } = useGameStore();

  const [infantry, setInfantry] = useState(0);
  const [cavalry, setCavalry] = useState(0);
  const [archer, setArcher] = useState(0);

  // 加载当前玩家的配置
  useEffect(() => {
    if (currentPlayer === Player.PLAYER1) {
      setInfantry(player1Army.infantry);
      setCavalry(player1Army.cavalry);
      setArcher(player1Army.archer);
    } else if (currentPlayer === Player.PLAYER2) {
      setInfantry(player2Army.infantry);
      setCavalry(player2Army.cavalry);
      setArcher(player2Army.archer);
    }
  }, [currentPlayer, player1Army, player2Army]);

  const totalCost = infantry * UNIT_COSTS.infantry +
                    cavalry * UNIT_COSTS.cavalry +
                    archer * UNIT_COSTS.archer;
  const remaining = BUDGET - totalCost;

  // 应用推荐配置
  const applyBuild = (build: typeof RECOMMENDED_BUILDS[0]) => {
    setInfantry(build.infantry);
    setCavalry(build.cavalry);
    setArcher(build.archer);
  };

  const handleConfirm = () => {
    setArmy(currentPlayer, infantry, cavalry, archer);

    if (currentPlayer === Player.PLAYER1) {
      // 切换到玩家2配兵
      useGameStore.setState({ currentPlayer: Player.PLAYER2 });
      // useEffect 会自动加载 player2Army 的配置
    } else if (currentPlayer === Player.PLAYER2) {
      // 两个玩家都配好了，重置为玩家1，进入设置大本营阶段
      useGameStore.setState({ currentPlayer: Player.PLAYER1 });
      nextPhase();
    }
  };

  const canConfirm = Math.abs(totalCost - BUDGET) < 0.01; // 精确使用预算

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-blue-50 flex items-center justify-center p-8">
      <div className="max-w-6xl w-full bg-white rounded-lg shadow-xl p-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">配置部队</h1>
          <p className="text-xl text-gray-600">
            {currentPlayer === Player.PLAYER1 ? '玩家 1' : '玩家 2'} 请分配你的 4 元预算
          </p>
        </div>

        {/* 推荐配置 */}
        <div className="mb-8">
          <h2 className="text-lg font-bold mb-3">推荐配置</h2>
          <div className="grid grid-cols-4 gap-3">
            {RECOMMENDED_BUILDS.map((build, index) => (
              <button
                key={index}
                onClick={() => applyBuild(build)}
                className="p-3 border-2 border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all text-left"
              >
                <h3 className="font-bold text-sm mb-1">{build.name}</h3>
                <p className="text-xs text-gray-600 mb-2">{build.description}</p>
                <div className="text-xs space-y-0.5">
                  <div>步兵: {build.infantry}</div>
                  <div>骑兵: {build.cavalry}</div>
                  <div>弓箭手: {build.archer}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="mb-8">
          <div className="flex justify-between items-center mb-4 p-4 bg-gray-100 rounded-lg">
            <span className="text-lg font-semibold">剩余预算:</span>
            <span className={`text-2xl font-bold ${remaining < 0 ? 'text-red-500' : 'text-green-500'}`}>
              {remaining.toFixed(1)} 元
            </span>
          </div>

          <div className="space-y-6">
            {/* 步兵 */}
            <div className="border-2 border-gray-200 rounded-lg p-4">
              <div className="flex justify-between items-center mb-3">
                <div>
                  <h3 className="text-xl font-bold">步兵</h3>
                  <p className="text-sm text-gray-600">一角/个 · 基础单位 · 移动1格 · 攻击范围1格</p>
                </div>
                <div className="text-lg font-semibold text-amber-600">
                  {(infantry * UNIT_COSTS.infantry).toFixed(1)} 元
                </div>
              </div>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setInfantry(Math.max(0, infantry - 1))}
                  className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
                >
                  -
                </button>
                <span className="text-2xl font-bold w-12 text-center">{infantry}</span>
                <button
                  onClick={() => setInfantry(infantry + 1)}
                  className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                >
                  +
                </button>
              </div>
            </div>

            {/* 骑兵 */}
            <div className="border-2 border-gray-200 rounded-lg p-4">
              <div className="flex justify-between items-center mb-3">
                <div>
                  <h3 className="text-xl font-bold">骑兵</h3>
                  <p className="text-sm text-gray-600">两角/个 · 移动2格 · 攻击范围1格 · 受伤退化为步兵</p>
                </div>
                <div className="text-lg font-semibold text-amber-600">
                  {(cavalry * UNIT_COSTS.cavalry).toFixed(1)} 元
                </div>
              </div>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setCavalry(Math.max(0, cavalry - 1))}
                  className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
                >
                  -
                </button>
                <span className="text-2xl font-bold w-12 text-center">{cavalry}</span>
                <button
                  onClick={() => setCavalry(cavalry + 1)}
                  className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                >
                  +
                </button>
              </div>
            </div>

            {/* 弓箭手 */}
            <div className="border-2 border-gray-200 rounded-lg p-4">
              <div className="flex justify-between items-center mb-3">
                <div>
                  <h3 className="text-xl font-bold">弓箭手</h3>
                  <p className="text-sm text-gray-600">五角/个 · 移动1格 · 无限射程 · 需要朝向</p>
                </div>
                <div className="text-lg font-semibold text-amber-600">
                  {(archer * UNIT_COSTS.archer).toFixed(1)} 元
                </div>
              </div>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setArcher(Math.max(0, archer - 1))}
                  className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
                >
                  -
                </button>
                <span className="text-2xl font-bold w-12 text-center">{archer}</span>
                <button
                  onClick={() => setArcher(archer + 1)}
                  className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center gap-4">
          {!canConfirm && (
            <p className="text-red-500 font-semibold">
              {remaining < 0 ? '预算超支！' : '请用完所有预算！'}
            </p>
          )}
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className={`
              px-8 py-3 rounded-lg font-bold text-lg transition-all duration-200
              ${canConfirm
                ? 'bg-green-500 text-white hover:bg-green-600 shadow-lg'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }
            `}
          >
            {currentPlayer === Player.PLAYER1 ? '确认配置（玩家2配兵）' : '确认配置（设置大本营）'}
          </button>
        </div>
      </div>
    </div>
  );
};
