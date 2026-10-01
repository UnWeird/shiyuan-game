import React, { useRef, useCallback, useState, useEffect } from 'react';
import { Unit, UnitType, Player, Direction } from '../../types';
import { hexToPixel } from '../../utils/hexUtils';
import {
  DIRECTIONAL_UNITS,
  INFO,
  PIECE,
  PIECE_FONT,
  UNIT_GLYPH,
  type PieceSkin,
} from '../../theme/boardTheme';

/**
 * 棋子：T2 玉石嵌片
 *
 * 规格：docs/board-art-spec.md §5
 *
 * 旧实现一枚棋子只承载 1 条信息（兵种），而且是靠**形状**承载的
 * （圆/菱形/三角/五角星），小尺寸下分不出来；弓箭手/将军/三种机关干脆没有字。
 * 体力、是否已行动、移动力全靠右侧面板的文字读。
 *
 * 现在统一成"圆玉片 + 一个汉字"，形状不再承载信息，改由这些通道承载：
 *
 *   玉片色     阵营
 *   汉字       兵种
 *   上弧分段   体力上限 / 当前体力
 *   下弧刻度   此刻还能走多远（来自服务端 validActions，不是客户端算的）
 *   朝向尖     朝向（只有弓/弩/投石有）
 *   压暗+斜杠  已行动
 *
 * 另外两个旧问题：
 *   - 方向箭头是深色粗线**画在棋子上面**，把三角形糊成一团黑 → 改成画在弧之外的独立尖角
 *   - drop-shadow(0 2px 3px) 是单向偏移投影，配平涂六边形就是贴纸感 → 去掉，不要立体
 */
interface UnitPieceProps {
  unit: Unit;
  hexSize: number;
  onClick?: (unit: Unit) => void;
  isSelected?: boolean;
  /** 幽灵：指令已发出、等服务端确认时画在目标格的半透明预览 */
  isGhost?: boolean;
  /** 这个单位有指令在途，压暗表示未落定 */
  isPending?: boolean;
  /** 指令刚被服务端拒绝，抖一下 */
  isRejected?: boolean;
  /**
   * 下弧刻度 = 此刻还能走几格。
   * 由 GameBoard 从服务端下发的 validActions 取 max(steps)，
   * **不要**在客户端按兵种硬编码一张移动力表 —— 那份数值住在服务端，会漂移。
   */
  moveSteps?: number;
  /** 已行动：同样由 validActions 推出（无合法移动也无合法攻击） */
  isSpent?: boolean;
}

/** 极坐标取点 */
const pol = (r: number, deg: number): [number, number] => [
  r * Math.cos((deg * Math.PI) / 180),
  r * Math.sin((deg * Math.PI) / 180),
];

/** 环形弧段 */
function arcPath(r: number, a0: number, a1: number): string {
  const [x0, y0] = pol(r, a0);
  const [x1, y1] = pol(r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)},${y0.toFixed(2)} A ${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

/** 对 flat-top 六边形的 6 条边 + 正北/正南 */
const ANGLE_BY_DIRECTION: Record<Direction, number> = {
  [Direction.EAST]: 0,
  [Direction.NORTH_EAST]: -60,
  [Direction.NORTH_WEST]: -120,
  [Direction.WEST]: 180,
  [Direction.SOUTH_WEST]: 120,
  [Direction.SOUTH_EAST]: 60,
  [Direction.NORTH]: -90,
  [Direction.SOUTH]: 90,
};

function skinOf(unit: Unit): PieceSkin {
  if (unit.type === UnitType.HUANGJIN_LISHI) return PIECE.huangjinLishi;
  if (unit.type === UnitType.HUANGJIN_ZEI) return PIECE.huangjinZei;
  if (unit.type === UnitType.NEUTRAL_MARKER) return PIECE.neutral;
  if (unit.owner === Player.PLAYER1) return PIECE.player1;
  if (unit.owner === Player.PLAYER2) return PIECE.player2;
  return PIECE.neutral;
}

export const UnitPiece: React.FC<UnitPieceProps> = ({
  unit,
  hexSize,
  onClick,
  isSelected = false,
  isGhost = false,
  isPending = false,
  isRejected = false,
  moveSteps,
  isSpent = false,
}) => {
  const center = hexToPixel(unit.position, hexSize);
  const rr = hexSize * 0.45;
  const skin = skinOf(unit);
  const glyph = UNIT_GLYPH[unit.type] ?? '兵';

  /* 移动 / 转向时的过渡，由 CSS 完成，这里只负责在变化时打一个短暂的 class */
  const [isMoving, setIsMoving] = useState(false);
  const prevPosition = useRef(unit.position);
  useEffect(() => {
    const p = prevPosition.current;
    const c = unit.position;
    if (p.q !== c.q || p.r !== c.r || p.s !== c.s) {
      setIsMoving(true);
      prevPosition.current = c;
      const t = setTimeout(() => setIsMoving(false), 300);
      return () => clearTimeout(t);
    }
  }, [unit.position]);

  /* 触摸兜底：有明显滑动就不算点击 */
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!onClick) return;
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }, [onClick]);
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!onClick || !touchStart.current) return;
    const t = e.changedTouches[0];
    if (Math.abs(t.clientX - touchStart.current.x) < 10 &&
        Math.abs(t.clientY - touchStart.current.y) < 10) {
      e.preventDefault();
      onClick(unit);
    }
    touchStart.current = null;
  }, [onClick, unit]);
  const handleClick = useCallback(() => { if (onClick) onClick(unit); }, [onClick, unit]);

  /* ── 体力弧：上方 104°，按体力上限等分，间隙 16° ── */
  const hpArcs = (() => {
    const total = 104;
    const gap = 16;
    const max = Math.max(1, unit.maxHp);
    const span = (total + gap) / max - gap;
    const start = -90 - total / 2;
    return Array.from({ length: max }, (_, i) => {
      const a0 = start + i * (span + gap);
      return { d: arcPath(rr * 1.3, a0, a0 + span), lit: i < unit.hp };
    });
  })();

  /* ── 移动力弧：下方每格一道 20°，间隙 12° ── */
  const moveArcs = (() => {
    if (!moveSteps || moveSteps < 1) return [];
    const tick = 20;
    const gap = 12;
    const start = 90 - ((moveSteps * tick + (moveSteps - 1) * gap) - tick) / 2;
    return Array.from({ length: moveSteps }, (_, i) => {
      const a = start - i * (tick + gap);
      return arcPath(rr * 1.3, a - tick / 2, a + tick / 2);
    });
  })();

  const hasFacing = DIRECTIONAL_UNITS.has(unit.type);

  return (
    <g
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className={[
        'unit-piece',
        isMoving ? 'unit-moving' : '',
        isGhost ? 'unit-ghost' : '',
        isPending ? 'unit-pending' : '',
        isRejected ? 'unit-rejected' : '',
      ].filter(Boolean).join(' ')}
      transform={`translate(${center.x}, ${center.y})`}
      style={{
        cursor: onClick && !isGhost ? 'pointer' : 'default',
        touchAction: 'none',
      }}
    >
      {/* 朝向尖：画在体力/移动弧之外（弧半径 1.3rr），否则会被弧盖住、几乎看不见 */}
      {hasFacing && (
        <g
          className="direction-indicator"
          transform={`rotate(${ANGLE_BY_DIRECTION[unit.direction] ?? 0})`}
        >
          <line
            x1={rr * 0.96} y1={0} x2={rr * 1.4} y2={0}
            stroke={INFO.face} strokeWidth={rr * 0.16}
          />
          <path
            d={`M ${rr * 1.4},${-rr * 0.48} L ${rr * 1.85},0 L ${rr * 1.4},${rr * 0.48} Z`}
            fill={INFO.face}
            stroke="rgba(0,0,0,0.35)"
            strokeWidth={rr * 0.05}
          />
        </g>
      )}

      {/* 玉片本体 + 金错内边。平涂，无渐变、无投影 */}
      <circle r={rr} fill={skin.face} />
      <circle r={rr * 0.9} fill="none" stroke={PIECE.rim} strokeWidth={rr * 0.063} />

      {/* 汉字：水平 textAnchor + 垂直 dominantBaseline="central"，不加任何 y 偏移。
          "middle" 是字母中线，CJK 下会偏下。 */}
      <text
        x={0}
        y={0}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={rr * 0.86}
        fontFamily={PIECE_FONT}
        fontWeight={600}
        fill={skin.glyph}
      >
        {glyph}
      </text>

      {/* 体力刻度 */}
      {hpArcs.map((a, i) => (
        <path
          key={`hp${i}`}
          d={a.d}
          fill="none"
          stroke={a.lit ? PIECE.hpLit : PIECE.hpDim}
          strokeWidth={rr * 0.2}
          strokeLinecap="round"
        />
      ))}

      {/* 移动力刻度 */}
      {moveArcs.map((d, i) => (
        <path
          key={`mv${i}`}
          d={d}
          fill="none"
          stroke={INFO.move}
          strokeWidth={rr * 0.2}
          strokeLinecap="round"
        />
      ))}

      {/* 已行动 */}
      {isSpent && !isGhost && (
        <>
          <circle r={rr} fill={PIECE.spentVeil} opacity={0.58} />
          <line
            x1={-rr * 0.66} y1={rr * 0.66} x2={rr * 0.66} y2={-rr * 0.66}
            stroke="rgba(255,255,255,0.55)"
            strokeWidth={rr * 0.11}
            strokeLinecap="round"
          />
        </>
      )}

      {/* 选中：细金环。棋盘层另有白框，这里只做棋子自身的呼应 */}
      {isSelected && !isGhost && (
        <circle
          className="info-ring"
          r={rr * 1.52}
          fill="none"
          stroke={INFO.pick}
          strokeWidth={rr * 0.1}
        />
      )}
    </g>
  );
};
