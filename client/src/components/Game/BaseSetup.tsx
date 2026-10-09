import React, { useState, useEffect } from 'react';
import { Player, HexCoord } from '../../types';
import { useGameStore } from '../../stores/gameStore';
import { HexMap } from '../Map/HexMap';
import { isInStartZone } from '../../utils/hexUtils';
import { colyseusService } from '../../services/ColyseusService';
import { useIsNarrowScreen, useIsPortrait } from '../../hooks/useMobile';

export const BaseSetup: React.FC = () => {
  // 窄屏布局：只看视口宽度，不看设备类型
  const isNarrow = useIsNarrowScreen();
  /** 竖屏棋盘转 90°，与对局界面保持一致（见 docs/layout-spec.md §3.6） */
  const boardRotate: 0 | 90 = useIsPortrait() ? 90 : 0;
  /**
   * 起始区在屏幕上的方位。
   *
   * ⚠️ 这里修掉了一个一直存在的文案错误：`isInStartZone` 的 'top' 指的是
   * **r >= 3**（见 shared/utils/hexUtils.ts），而 hexToPixel 是 `y = 1.5·size·r`，
   * SVG 的 y 向下增长 —— 所以 r >= 3 渲染在**屏幕下方**。
   * 原来的文案写的是「玩家一 · 在**上方**起始区选择」，而合法格全在下方，
   * 等于把玩家往反方向指。两方都反了。
   *
   * 另外 rotate(90) 把 (x,y) 映射到 (-y, x)：下方（+y）变成左侧（-x）。
   */
  const zoneWord = (zone: 'top' | 'bottom') =>
    boardRotate === 90
      ? (zone === 'top' ? '左侧起始区' : '右侧起始区')
      : (zone === 'top' ? '下方起始区' : '上方起始区');
  const {
    currentPlayer,
    player1Base,
    player2Base,
    setBase,
    nextPhase,
    isOnlineMode,
    isHotseat,
    myPlayerRole,
  } = useGameStore();

  const [tempBase, setTempBase] = useState<HexCoord | null>(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  // 获取我的大本营和对手的大本营
  // 同机轮流下没有「对手在另一端」这回事：双方都是你自己按顺序操作。
  // 所以「等待对手」这类 UI 只在真人对战时显示。
  const isVersus = isOnlineMode && !isHotseat;
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

  // 同步成这一方的状态。
  //
  // 原来只在 myBase 存在时把 hasSubmitted 置 true、从不置回 false，
  // 同机轮流下玩家一设置完后玩家二会被判成「已设置」而无法确认。
  //
  // 依赖里必须带上「这一方是谁」：交接时 myBase 的**含义**变了但**值没变**
  // —— 交接前是玩家一还没设的大本营(null)，交接后是玩家二还没设的(也是 null)，
  // 只依赖 myBase 的话 effect 根本不会重跑。
  useEffect(() => {
    setTempBase(myBase ?? null);
    setHasSubmitted(!!myBase);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myBase, myPlayerRole, currentPlayer]);

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
  const waitingForOpponent = isVersus && hasSubmitted && !opponentDone;

  const canConfirm = !!tempBase && !hasSubmitted;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 md:p-6 relative overflow-hidden"
      style={{ background: 'radial-gradient(ellipse at 50% 10%, #2a0a00 0%, #0d0500 60%, #050200 100%)' }}
    >
      {/* 背景网格 */}
      <div className="absolute inset-0 opacity-10" style={{
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 40px, rgba(201,162,39,0.12) 40px, rgba(201,162,39,0.12) 41px), repeating-linear-gradient(90deg, transparent, transparent 40px, rgba(201,162,39,0.12) 40px, rgba(201,162,39,0.12) 41px)'
      }} />

      <div className="relative z-10 max-w-4xl w-full">
        {/* 标题区 */}
        <div className="text-center mb-4">
          <h1 className="font-ancient text-3xl md:text-4xl tracking-[0.3em]" style={{ color: '#C9A227', textShadow: '0 0 20px rgba(201,162,39,0.4)' }}>
            安 置 大 本 营
          </h1>
          <div className="flex items-center justify-center gap-3 my-2">
            <div className="h-px w-16 bg-gradient-to-r from-transparent to-imperial-gold/40" />
            <div className="w-1.5 h-1.5 rotate-45 bg-imperial-gold/40" />
            <div className="h-px w-16 bg-gradient-to-l from-transparent to-imperial-gold/40" />
          </div>
          <p className="font-chinese text-xs tracking-widest" style={{ color: 'rgba(201,162,39,0.55)' }}>
            {isOnlineMode
              ? `${myPlayerRole === 'player1' ? '玩家一' : '玩家二'} · 在${zoneWord(myZone)}选择大本营位置`
              : `${currentPlayer === Player.PLAYER1 ? '玩家一' : '玩家二'} · 在${zoneWord(currentPlayer === Player.PLAYER1 ? 'top' : 'bottom')}选择位置`
            }
          </p>
          <p className="font-chinese text-xs mt-1" style={{ color: 'rgba(245,230,200,0.3)' }}>
            胜利条件：敌方单位触碰到大本营
          </p>
          {isVersus && (
            <p className="font-chinese text-xs mt-1" style={{ color: opponentDone ? 'rgba(100,200,100,0.7)' : 'rgba(201,162,39,0.4)' }}>
              {opponentDone ? '对手已完成设置' : '对手设置中...'}
            </p>
          )}
        </div>

        {/* 地图容器 */}
        <div className="rounded mb-4"
          style={{
            height: isNarrow ? '350px' : '560px',
            border: '1px solid rgba(201,162,39,0.25)',
            background: 'rgba(13,5,0,0.7)',
            boxShadow: 'inset 0 0 40px rgba(0,0,0,0.5)',
          }}
        >
          <HexMap
            radius={5}
            hexSize={isNarrow ? 25 : 40}
            rotate={boardRotate}
            onHexClick={handleHexClick}
            highlightedHexes={highlightedHexes}
          />
        </div>

        {/* 底部操作区 */}
        <div className="flex flex-col items-center gap-3">
          {waitingForOpponent && (
            <p className="font-chinese text-sm tracking-wider" style={{ color: 'rgba(201,162,39,0.7)' }}>
              大本营已设置，等待对手完成...
            </p>
          )}
          {hasSubmitted && opponentDone && (
            <p className="font-chinese text-sm tracking-wider" style={{ color: 'rgba(100,200,100,0.8)' }}>
              双方设置完成，即将进入部署阶段
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
              ? (hasSubmitted ? '已设置位置' : '确认位置')
              : (currentPlayer === Player.PLAYER1 ? '确认（下一位设置）' : '确认（开始游戏）')
            }
          </button>
        </div>
      </div>
    </div>
  );
};
