import React, { useMemo } from 'react';
import { HexCoord } from '../../types';
import { generateHexMap, hexToPixel, hexEquals, isInStartZone } from '../../utils/hexUtils';
import { HexTile } from './HexTile';
import { useGameStore } from '../../stores/gameStore';

interface HexMapProps {
  radius: number;
  hexSize: number;
  onHexClick?: (hex: HexCoord) => void;
  highlightedHexes?: (HexCoord & { steps?: number })[];
}

export const HexMap: React.FC<HexMapProps> = React.memo(({
  radius,
  hexSize,
  onHexClick,
  highlightedHexes = [],
}) => {
  const { player1Base, player2Base, selectedUnitId, units } = useGameStore();

  // 生成地图
  const hexes = useMemo(() => generateHexMap(radius), [radius]);

  // 计算SVG视图框
  const viewBox = useMemo(() => {
    const maxX = hexSize * Math.sqrt(3) * radius;
    const maxY = hexSize * 1.5 * radius;
    const padding = hexSize;
    return {
      minX: -maxX - padding,
      minY: -maxY - padding,
      width: (maxX + padding) * 2,
      height: (maxY + padding) * 2,
    };
  }, [radius, hexSize]);

  // 获取选中的单位位置
  const selectedUnit = selectedUnitId ? units[selectedUnitId] : null;

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`}
      className="border border-gray-300 rounded-lg bg-white"
    >
      {/* 渲染所有六边形 */}
      {hexes.map((hex, index) => {
        const isPlayer1Zone = isInStartZone(hex, 'top');
        const isPlayer2Zone = isInStartZone(hex, 'bottom');
        const isBase1 = player1Base ? hexEquals(hex, player1Base) : false;
        const isBase2 = player2Base ? hexEquals(hex, player2Base) : false;
        const isSelected = selectedUnit ? hexEquals(hex, selectedUnit.position) : false;
        const highlightedHex = highlightedHexes.find(h => hexEquals(h, hex));
        const isHighlighted = !!highlightedHex;
        const highlightSteps = highlightedHex?.steps;

        return (
          <HexTile
            key={`${hex.q},${hex.r},${hex.s}-${index}`}
            hex={hex}
            size={hexSize}
            onClick={onHexClick}
            isBase={isBase1 || isBase2}
            isSelected={isSelected}
            isHighlighted={isHighlighted}
            highlightSteps={highlightSteps}
            isPlayer1Zone={isPlayer1Zone}
            isPlayer2Zone={isPlayer2Zone}
          />
        );
      })}

      {/* 绘制基地标记 - 玩家1（琥珀金色） */}
      {player1Base && (
        <g>
          {/* 外层光晕 */}
          <circle
            cx={hexToPixel(player1Base, hexSize).x}
            cy={hexToPixel(player1Base, hexSize).y}
            r={hexSize * 0.45}
            fill="url(#player1BaseGlow)"
            opacity={0.6}
          />
          {/* 主圆 */}
          <circle
            cx={hexToPixel(player1Base, hexSize).x}
            cy={hexToPixel(player1Base, hexSize).y}
            r={hexSize * 0.35}
            fill="url(#player1BaseGradient)"
            stroke="#b45309"
            strokeWidth={3}
          />
          {/* 内圈装饰 */}
          <circle
            cx={hexToPixel(player1Base, hexSize).x}
            cy={hexToPixel(player1Base, hexSize).y}
            r={hexSize * 0.28}
            fill="none"
            stroke="#fbbf24"
            strokeWidth={2}
            strokeDasharray="4,4"
            opacity={0.8}
          />
          <text
            x={hexToPixel(player1Base, hexSize).x}
            y={hexToPixel(player1Base, hexSize).y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={hexSize * 0.35}
            fill="white"
            fontWeight="bold"
            style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.5)' }}
          >
            P1
          </text>
        </g>
      )}

      {/* 绘制基地标记 - 玩家2（浅蓝色） */}
      {player2Base && (
        <g>
          {/* 外层光晕 */}
          <circle
            cx={hexToPixel(player2Base, hexSize).x}
            cy={hexToPixel(player2Base, hexSize).y}
            r={hexSize * 0.45}
            fill="url(#player2BaseGlow)"
            opacity={0.6}
          />
          {/* 主圆 */}
          <circle
            cx={hexToPixel(player2Base, hexSize).x}
            cy={hexToPixel(player2Base, hexSize).y}
            r={hexSize * 0.35}
            fill="url(#player2BaseGradient)"
            stroke="#1e40af"
            strokeWidth={3}
          />
          {/* 内圈装饰 */}
          <circle
            cx={hexToPixel(player2Base, hexSize).x}
            cy={hexToPixel(player2Base, hexSize).y}
            r={hexSize * 0.28}
            fill="none"
            stroke="#60a5fa"
            strokeWidth={2}
            strokeDasharray="4,4"
            opacity={0.8}
          />
          <text
            x={hexToPixel(player2Base, hexSize).x}
            y={hexToPixel(player2Base, hexSize).y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={hexSize * 0.35}
            fill="white"
            fontWeight="bold"
            style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.5)' }}
          >
            P2
          </text>
        </g>
      )}

      {/* 定义渐变色 */}
      <defs>
        {/* 玩家1渐变 */}
        <radialGradient id="player1BaseGradient">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#f59e0b" />
        </radialGradient>
        <radialGradient id="player1BaseGlow">
          <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
        </radialGradient>

        {/* 玩家2渐变 */}
        <radialGradient id="player2BaseGradient">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#3b82f6" />
        </radialGradient>
        <radialGradient id="player2BaseGlow">
          <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#60a5fa" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
});
