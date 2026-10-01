import React, { useEffect } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { useUIStore } from '../../stores/uiStore';
import { IMPERIAL } from '../../theme/boardTheme';
import { playSfx } from '../../audio/sfx';

interface GameOverOverlayProps {
  /** 点击「重新开始 / 返回」时调用，由 App 决定导航去向 */
  onRestart: () => void;
}

/** 阵营显示名，与棋盘配色对应 */
const SIDE_LABEL: Record<string, string> = {
  player1: '朱红',
  player2: '青玉',
};

type Outcome = 'win' | 'lose' | 'neutral';

/** 三种结果的视觉方案 */
const OUTCOME_STYLE: Record<Outcome, {
  seal: string;          // 印章底色
  sealBorder: string;
  sealText: string;      // 印文颜色
  char: string;          // 印文
  title: string;
  titleColor: string;
}> = {
  win: {
    seal: 'linear-gradient(145deg, #A81F1F 0%, #7A1414 100%)',
    sealBorder: '#E8C84A',
    sealText: '#F5E6C8',
    char: '勝',
    title: '得胜',
    titleColor: '#E8C84A',
  },
  lose: {
    seal: 'linear-gradient(145deg, #3A3A3A 0%, #1C1C1C 100%)',
    sealBorder: 'rgba(201,162,39,0.35)',
    sealText: '#B8AE9A',
    char: '負',
    title: '败北',
    titleColor: '#9C8B72',
  },
  neutral: {
    seal: 'linear-gradient(145deg, #8B6914 0%, #5C4410 100%)',
    sealBorder: '#C9A227',
    sealText: '#F5E6C8',
    char: '終',
    title: '对弈终了',
    titleColor: '#C9A227',
  },
};

/**
 * 胜负结算画面。
 * 原来这里是 alert('游戏结束！...')，之后落到一个不显示胜方的「对弈终了」页。
 */
export const GameOverOverlay: React.FC<GameOverOverlayProps> = ({ onRestart }) => {
  const gameOver = useUIStore(state => state.gameOver);
  const myPlayerRole = useGameStore(state => state.myPlayerRole);
  // 同机轮流下 myPlayerRole 是跟着当前行动方走的，拿它判胜负没有意义
  // （一个人操作双方，本来就没有「我方」），所以走中性结果。
  const isHotseat = useGameStore(state => state.isHotseat);

  // 判定视角：单机 / 观战 / 服务端未告知胜方时都走中性结果
  let outcome: Outcome = 'neutral';
  if (gameOver && !isHotseat && myPlayerRole && myPlayerRole !== 'spectator') {
    outcome = gameOver.winner === myPlayerRole ? 'win' : 'lose';
  }

  const style = OUTCOME_STYLE[outcome];
  const winnerSide = gameOver ? SIDE_LABEL[gameOver.winner] : null;

  // 结算锣声：随印章落定一起响，中性结果（单机/观战）也用胜的锣
  useEffect(() => {
    playSfx(outcome === 'lose' ? 'defeat' : 'victory');
  }, [outcome]);

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: 'radial-gradient(ellipse at 50% 30%, #2a0a00 0%, #0d0500 50%, #050200 100%)' }}
    >
      {/* 背景纹样 */}
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 40px, rgba(201,162,39,0.15) 40px, rgba(201,162,39,0.15) 41px), repeating-linear-gradient(90deg, transparent, transparent 40px, rgba(201,162,39,0.15) 40px, rgba(201,162,39,0.15) 41px)',
        }}
      />
      {/* 四角装饰 */}
      <div className="absolute top-4 left-4 w-16 h-16 border-t-2 border-l-2 border-imperial-gold opacity-40" />
      <div className="absolute top-4 right-4 w-16 h-16 border-t-2 border-r-2 border-imperial-gold opacity-40" />
      <div className="absolute bottom-4 left-4 w-16 h-16 border-b-2 border-l-2 border-imperial-gold opacity-40" />
      <div className="absolute bottom-4 right-4 w-16 h-16 border-b-2 border-r-2 border-imperial-gold opacity-40" />

      <div className="relative z-10 flex flex-col items-center max-w-md w-full">
        {/* 印章 */}
        <div
          className="seal-stamp w-28 h-28 rounded-md flex items-center justify-center mb-7"
          style={{
            background: style.seal,
            border: `2px solid ${style.sealBorder}`,
            boxShadow: `0 0 40px ${style.sealBorder}40, inset 0 2px 8px rgba(0,0,0,0.45)`,
          }}
        >
          <span
            className="font-ancient text-6xl leading-none select-none"
            style={{ color: style.sealText, textShadow: '0 2px 6px rgba(0,0,0,0.5)' }}
          >
            {style.char}
          </span>
        </div>

        <div className="result-rise w-full flex flex-col items-center">
          {/* 标题 */}
          <h1
            className={`font-ancient text-5xl tracking-[0.3em] mb-3 ${outcome === 'win' ? 'result-glow' : ''}`}
            style={{ color: style.titleColor }}
          >
            {style.title}
          </h1>

          {/* 分割线 */}
          <div className="flex items-center gap-3 w-full max-w-xs mb-4">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent to-imperial-gold/40" />
            <div className="w-1.5 h-1.5 rotate-45 bg-imperial-gold/50" />
            <div className="flex-1 h-px bg-gradient-to-l from-transparent to-imperial-gold/40" />
          </div>

          {/* 胜方 */}
          {winnerSide && (
            <p className="font-chinese text-base tracking-[0.2em] mb-2" style={{ color: IMPERIAL.parchmentDark }}>
              <span style={{ color: gameOver!.winner === 'player1' ? IMPERIAL.redLight : '#3F8A66' }}>
                {winnerSide}
              </span>
              <span className="opacity-70"> 一方得胜</span>
            </p>
          )}

          {/* 结束原因 */}
          {gameOver?.message && (
            <p
              className="font-chinese text-sm text-center leading-relaxed mb-8 px-4"
              style={{ color: 'rgba(245,230,200,0.6)' }}
            >
              {gameOver.message}
            </p>
          )}
          {!gameOver && <div className="mb-8" />}

          <button
            onClick={onRestart}
            className="px-10 py-3 rounded border font-chinese tracking-[0.25em] transition-all duration-300"
            style={{
              borderColor: 'rgba(201,162,39,0.5)',
              color: '#E8C84A',
              background: 'linear-gradient(135deg, rgba(139,26,26,0.35) 0%, rgba(26,10,0,0.8) 100%)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'rgba(201,162,39,0.9)';
              e.currentTarget.style.boxShadow = '0 0 24px rgba(201,162,39,0.3)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'rgba(201,162,39,0.5)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            再来一局
          </button>
        </div>
      </div>
    </div>
  );
};

export default GameOverOverlay;
