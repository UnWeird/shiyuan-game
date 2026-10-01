import React, { useState, useEffect } from 'react';
import { Player } from '../../types';
import { useGameStore } from '../../stores/gameStore';
import { colyseusService } from '../../services/ColyseusService';

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
    isOnlineMode,
    isHotseat,
    myPlayerRole,
  } = useGameStore();

  const [infantry, setInfantry] = useState(0);
  const [cavalry, setCavalry] = useState(0);
  const [archer, setArcher] = useState(0);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  // 获取我的军队和对手的军队
  // 同机轮流下没有「对手在另一端」这回事：双方都是你自己按顺序操作。
  // 所以「等待对手」这类 UI 只在真人对战时显示。
  const isVersus = isOnlineMode && !isHotseat;
  const myArmy = isOnlineMode && myPlayerRole
    ? (myPlayerRole === 'player1' ? player1Army : player2Army)
    : (currentPlayer === Player.PLAYER1 ? player1Army : player2Army);

  const opponentArmy = isOnlineMode && myPlayerRole
    ? (myPlayerRole === 'player1' ? player2Army : player1Army)
    : null;

  // 行动方切换（同机轮流）或初次进入时，把表单和「是否已提交」同步成这一方的状态。
  //
  // 原来的实现只会把 hasSubmitted 置 true、从不置回 false，
  // 而且表单只在「当前为空」时才加载。同机轮流下玩家一提交后，
  // 玩家二会拿到玩家一的数字、而且确认按钮永远是禁用的 —— 直接卡住。
  // 改成从 myArmy 完整推导，不再是粘住的状态。
  useEffect(() => {
    setInfantry(myArmy.infantry);
    setCavalry(myArmy.cavalry);
    setArcher(myArmy.archer);
    setHasSubmitted(myArmy.infantry > 0 || myArmy.cavalry > 0 || myArmy.archer > 0);
    // 依赖「这一方是谁」而不是 army 本身，避免编辑过程中被回写覆盖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPlayer, myPlayerRole]);

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
    if (isOnlineMode) {
      // 在线模式：发送给服务器
      colyseusService.buildArmy({ infantry, cavalry, archer });
      setHasSubmitted(true);
    } else {
      // 单机模式：原有逻辑
      setArmy(currentPlayer, infantry, cavalry, archer);

      if (currentPlayer === Player.PLAYER1) {
        // 切换到玩家2配兵
        useGameStore.setState({ currentPlayer: Player.PLAYER2 });
      } else if (currentPlayer === Player.PLAYER2) {
        // 两个玩家都配好了，重置为玩家1，进入设置大本营阶段
        useGameStore.setState({ currentPlayer: Player.PLAYER1 });
        nextPhase();
      }
    }
  };

  const canConfirm = Math.abs(totalCost - BUDGET) < 0.01 && !hasSubmitted; // 精确使用预算且未提交

  // 判断对手是否已配置
  const opponentDone = opponentArmy && (opponentArmy.infantry > 0 || opponentArmy.cavalry > 0 || opponentArmy.archer > 0);
  const waitingForOpponent = isVersus && hasSubmitted && !opponentDone;

  // 共用样式常量
  const panelStyle = {
    background: 'linear-gradient(180deg, rgba(26,10,0,0.95) 0%, rgba(13,5,0,0.98) 100%)',
    border: '1px solid rgba(201,162,39,0.3)',
    boxShadow: '0 0 40px rgba(201,162,39,0.1), inset 0 1px 0 rgba(201,162,39,0.15)',
  };

  const unitCardStyle = (active: boolean) => ({
    background: active
      ? 'linear-gradient(135deg, rgba(26,10,0,0.9) 0%, rgba(13,5,0,0.95) 100%)'
      : 'rgba(13,5,0,0.6)',
    border: active ? '1px solid rgba(201,162,39,0.5)' : '1px solid rgba(201,162,39,0.15)',
    transition: 'all 0.3s',
  });

  return (
    <div className="min-h-screen flex items-center justify-center p-4 md:p-6 relative overflow-hidden"
      style={{ background: 'radial-gradient(ellipse at 50% 20%, #2a0a00 0%, #0d0500 60%, #050200 100%)' }}
    >
      {/* 背景网格 */}
      <div className="absolute inset-0 opacity-10" style={{
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 40px, rgba(201,162,39,0.12) 40px, rgba(201,162,39,0.12) 41px), repeating-linear-gradient(90deg, transparent, transparent 40px, rgba(201,162,39,0.12) 40px, rgba(201,162,39,0.12) 41px)'
      }} />

      <div className="relative z-10 max-w-4xl w-full" style={panelStyle as React.CSSProperties}>
        <div className="p-5 md:p-8">
          {/* 标题 */}
          <div className="text-center mb-6">
            <h1 className="font-ancient text-3xl md:text-4xl tracking-[0.3em] mb-2" style={{ color: '#C9A227', textShadow: '0 0 20px rgba(201,162,39,0.4)' }}>
              点 兵 配 将
            </h1>
            <div className="flex items-center justify-center gap-3 mb-2">
              <div className="h-px w-20 bg-gradient-to-r from-transparent to-imperial-gold/40" />
              <div className="w-1.5 h-1.5 rotate-45 bg-imperial-gold/40" />
              <div className="h-px w-20 bg-gradient-to-l from-transparent to-imperial-gold/40" />
            </div>
            <p className="font-chinese text-sm tracking-widest" style={{ color: 'rgba(201,162,39,0.6)' }}>
              {isOnlineMode
                ? `${myPlayerRole === 'player1' ? '玩家一' : '玩家二'} · 分配四元军费`
                : `${currentPlayer === Player.PLAYER1 ? '玩家一' : '玩家二'} · 分配四元军费`
              }
            </p>
            {isVersus && opponentArmy && (
              <p className="font-chinese text-xs mt-1" style={{ color: opponentDone ? 'rgba(100,200,100,0.7)' : 'rgba(201,162,39,0.4)' }}>
                {opponentDone ? '对手已完成配兵' : '对手配兵中...'}
              </p>
            )}
          </div>

          {/* 预算条 */}
          <div className="flex items-center justify-between mb-5 px-4 py-3 rounded"
            style={{ background: 'rgba(201,162,39,0.08)', border: '1px solid rgba(201,162,39,0.2)' }}
          >
            <span className="font-chinese text-sm tracking-wider" style={{ color: 'rgba(245,230,200,0.7)' }}>剩余军费</span>
            <span className="font-ancient text-2xl" style={{ color: remaining < 0 ? '#ef4444' : remaining === 0 ? '#4ade80' : '#C9A227', textShadow: remaining === 0 ? '0 0 10px rgba(74,222,128,0.4)' : 'none' }}>
              {remaining.toFixed(1)} 元
            </span>
          </div>

          {/* 推荐配置 */}
          <div className="mb-5">
            <p className="font-chinese text-xs tracking-widest mb-3" style={{ color: 'rgba(201,162,39,0.5)' }}>— 推荐阵容 —</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {RECOMMENDED_BUILDS.map((build, index) => (
                <button
                  key={index}
                  onClick={() => applyBuild(build)}
                  disabled={hasSubmitted}
                  className="p-3 rounded text-left transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: 'rgba(13,5,0,0.7)', border: '1px solid rgba(201,162,39,0.2)' }}
                  onMouseEnter={e => !hasSubmitted && ((e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(201,162,39,0.6)')}
                  onMouseLeave={e => !hasSubmitted && ((e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(201,162,39,0.2)')}
                >
                  <h3 className="font-chinese font-medium text-sm mb-1" style={{ color: '#C9A227' }}>{build.name}</h3>
                  <p className="font-chinese text-xs mb-2" style={{ color: 'rgba(245,230,200,0.45)' }}>{build.description}</p>
                  <div className="font-chinese text-xs space-y-0.5" style={{ color: 'rgba(245,230,200,0.6)' }}>
                    <div>步兵 {build.infantry}</div>
                    <div>骑兵 {build.cavalry}</div>
                    <div>弓箭手 {build.archer}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 兵种调整 */}
          <div className="space-y-3 mb-6">
            {[
              { label: '步兵', desc: '一角/个 · 移动1格 · 攻击范围1格', count: infantry, cost: infantry * UNIT_COSTS.infantry, setFn: setInfantry },
              { label: '骑兵', desc: '两角/个 · 移动2格 · 受伤退化步兵', count: cavalry, cost: cavalry * UNIT_COSTS.cavalry, setFn: setCavalry },
              { label: '弓箭手', desc: '五角/个 · 无限射程 · 需要朝向', count: archer, cost: archer * UNIT_COSTS.archer, setFn: setArcher },
            ].map(({ label, desc, count, cost, setFn }) => (
              <div key={label} className="p-4 rounded" style={unitCardStyle(count > 0) as React.CSSProperties}>
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-baseline gap-3">
                      <h3 className="font-ancient text-xl" style={{ color: count > 0 ? '#E8C84A' : '#C9A227' }}>{label}</h3>
                      <p className="font-chinese text-xs" style={{ color: 'rgba(245,230,200,0.45)' }}>{desc}</p>
                    </div>
                  </div>
                  <span className="font-chinese text-sm ml-3" style={{ color: 'rgba(201,162,39,0.7)' }}>{cost.toFixed(1)} 元</span>
                </div>
                <div className="flex items-center gap-4 mt-3">
                  <button
                    onClick={() => setFn(Math.max(0, count - 1))}
                    disabled={hasSubmitted}
                    className="w-9 h-9 rounded flex items-center justify-center font-bold text-lg transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{ border: '1px solid rgba(220,60,60,0.5)', color: '#ef9999', background: 'rgba(139,26,26,0.3)' }}
                    onMouseEnter={e => !hasSubmitted && ((e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(220,60,60,0.9)')}
                    onMouseLeave={e => !hasSubmitted && ((e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(220,60,60,0.5)')}
                  >−</button>
                  <span className="font-ancient text-2xl w-12 text-center" style={{ color: '#E8C84A' }}>{count}</span>
                  <button
                    onClick={() => setFn(count + 1)}
                    disabled={hasSubmitted}
                    className="w-9 h-9 rounded flex items-center justify-center font-bold text-lg transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{ border: '1px solid rgba(100,200,100,0.5)', color: '#99ef99', background: 'rgba(26,80,26,0.3)' }}
                    onMouseEnter={e => !hasSubmitted && ((e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(100,200,100,0.9)')}
                    onMouseLeave={e => !hasSubmitted && ((e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(100,200,100,0.5)')}
                  >+</button>
                </div>
              </div>
            ))}
          </div>

          {/* 底部状态 & 按钮 */}
          <div className="flex flex-col items-center gap-3">
            {waitingForOpponent && (
              <p className="font-chinese text-sm tracking-wider" style={{ color: 'rgba(201,162,39,0.7)' }}>
                已提交配置，等待对手完成...
              </p>
            )}
            {hasSubmitted && opponentDone && (
              <p className="font-chinese text-sm tracking-wider" style={{ color: 'rgba(100,200,100,0.8)' }}>
                双方配置完成，即将进入大本营设置
              </p>
            )}
            {!canConfirm && !hasSubmitted && (
              <p className="font-chinese text-sm tracking-wider" style={{ color: remaining < 0 ? '#ef4444' : 'rgba(201,162,39,0.6)' }}>
                {remaining < 0 ? '军费超支' : '请用尽所有军费'}
              </p>
            )}
            <button
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="px-10 py-3 rounded font-chinese tracking-widest transition-all duration-300"
              style={{
                border: canConfirm ? '1px solid rgba(201,162,39,0.7)' : '1px solid rgba(201,162,39,0.15)',
                color: canConfirm ? '#E8C84A' : 'rgba(201,162,39,0.25)',
                background: canConfirm ? 'linear-gradient(135deg, rgba(139,26,26,0.5) 0%, rgba(26,10,0,0.9) 100%)' : 'rgba(13,5,0,0.5)',
                cursor: canConfirm ? 'pointer' : 'not-allowed',
                boxShadow: canConfirm ? '0 0 20px rgba(201,162,39,0.2)' : 'none',
              }}
              onMouseEnter={e => canConfirm && ((e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 30px rgba(201,162,39,0.4)')}
              onMouseLeave={e => canConfirm && ((e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 20px rgba(201,162,39,0.2)')}
            >
              {isOnlineMode
                ? (hasSubmitted ? '已提交配置' : '确认配置')
                : (currentPlayer === Player.PLAYER1 ? '确认（下一位配兵）' : '确认（设置大本营）')
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
