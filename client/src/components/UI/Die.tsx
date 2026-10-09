import React from 'react';
import { PIECE } from '../../theme/boardTheme';

/**
 * 骰子
 *
 * 原来是一个 `w-8 h-8 border-2 rounded-md` 的方块里写个数字 —— 占位感很强，
 * 而骰子是这个游戏的核心资源（行动点 = 骰子点数之和，部署价值决定骰子数量），
 * 值得有真正的骰面。
 *
 * 骨色面 + 朱色点，和棋子的玉石材质同一套语言；边框颜色承载来源：
 *   jade  基础骰（部署价值换来的）
 *   gold  击杀奖励骰
 *   lost  永久失去的骰位（画成空位 + ✕，不画点数）
 */

/** 3×3 网格上的点位，x/y 取 0/1/2 */
const PIP_LAYOUT: Record<number, ReadonlyArray<readonly [number, number]>> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

export type DieVariant = 'base' | 'kill' | 'lost';

const BORDER: Record<DieVariant, string> = {
  base: 'rgba(63,138,102,0.85)',
  kill: 'rgba(201,162,39,0.9)',
  lost: 'rgba(139,105,20,0.45)',
};

interface DieProps {
  /** 点数 1–6；lost 变体不显示点数 */
  value?: number;
  variant?: DieVariant;
  /** 被选中（神机改点数 / 重掷时的目标） */
  selected?: boolean;
  /** 可点击时给出指针与悬停反馈 */
  interactive?: boolean;
  onClick?: () => void;
  size?: number;
}

export const Die: React.FC<DieProps> = ({
  value,
  variant = 'base',
  selected = false,
  interactive = false,
  onClick,
  size = 32,
}) => {
  const lost = variant === 'lost';
  const pips = !lost && value && PIP_LAYOUT[value] ? PIP_LAYOUT[value] : [];
  // 3×3 网格映射到骰面内部：留出边距，点半径随尺寸缩放
  const pad = size * 0.26;
  const step = (size - pad * 2) / 2;
  const r = size * 0.085;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role={interactive ? 'button' : 'img'}
      aria-label={lost ? '永久失去的骰位' : `骰子 ${value ?? ''}`}
      onClick={onClick}
      className={[
        'shrink-0 transition-transform',
        interactive ? 'cursor-pointer hover:scale-110' : '',
        selected ? 'scale-110' : '',
      ].filter(Boolean).join(' ')}
      style={{ display: 'block' }}
    >
      <rect
        x={1}
        y={1}
        width={size - 2}
        height={size - 2}
        rx={size * 0.2}
        fill={lost ? 'rgba(13,5,0,0.5)' : PIECE.hpLit}
        stroke={selected ? '#CD7F32' : BORDER[variant]}
        strokeWidth={selected ? 2.4 : 1.6}
      />

      {/* 骨色面上压一层极淡的暖色，避免纯白的塑料感 */}
      {!lost && (
        <rect
          x={1}
          y={1}
          width={size - 2}
          height={size - 2}
          rx={size * 0.2}
          fill="rgba(160,120,50,0.08)"
        />
      )}

      {pips.map(([gx, gy]) => (
        <circle
          key={`${gx}-${gy}`}
          cx={pad + gx * step}
          cy={pad + gy * step}
          r={r}
          fill={PIECE.player1.glyph}
        />
      ))}

      {lost && (
        <g stroke="rgba(201,162,39,0.35)" strokeWidth={1.8} strokeLinecap="round">
          <line x1={size * 0.34} y1={size * 0.34} x2={size * 0.66} y2={size * 0.66} />
          <line x1={size * 0.66} y1={size * 0.34} x2={size * 0.34} y2={size * 0.66} />
        </g>
      )}
    </svg>
  );
};

export default Die;
