import React, { useMemo } from 'react';
import { HexCoord } from '../../types';
import { generateHexMap, hexToPixel, hexEquals, isInStartZone } from '../../utils/hexUtils';
import { HexTile } from './HexTile';
import { useGameStore } from '../../stores/gameStore';

interface HexMapProps {
  radius: number;
  hexSize: number;
  onHexClick?: (hex: HexCoord) => void;
  highlightedHexes?: HexCoord[];
}

export const HexMap: React.FC<HexMapProps> = ({
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
        const isHighlighted = highlightedHexes.some(h => hexEquals(h, hex));

        return (
          <HexTile
            key={`${hex.q},${hex.r},${hex.s}-${index}`}
            hex={hex}
            size={hexSize}
            onClick={onHexClick}
            isBase={isBase1 || isBase2}
            isSelected={isSelected}
            isHighlighted={isHighlighted}
            isPlayer1Zone={isPlayer1Zone}
            isPlayer2Zone={isPlayer2Zone}
          />
        );
      })}

      {/* 绘制基地标记 */}
      {player1Base && (
        <g>
          <circle
            cx={hexToPixel(player1Base, hexSize).x}
            cy={hexToPixel(player1Base, hexSize).y}
            r={hexSize * 0.3}
            fill="#f59e0b"
            stroke="#92400e"
            strokeWidth={2}
          />
          <text
            x={hexToPixel(player1Base, hexSize).x}
            y={hexToPixel(player1Base, hexSize).y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={hexSize * 0.4}
            fill="white"
            fontWeight="bold"
          >
            P1
          </text>
        </g>
      )}

      {player2Base && (
        <g>
          <circle
            cx={hexToPixel(player2Base, hexSize).x}
            cy={hexToPixel(player2Base, hexSize).y}
            r={hexSize * 0.3}
            fill="#3b82f6"
            stroke="#1e3a8a"
            strokeWidth={2}
          />
          <text
            x={hexToPixel(player2Base, hexSize).x}
            y={hexToPixel(player2Base, hexSize).y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={hexSize * 0.4}
            fill="white"
            fontWeight="bold"
          >
            P2
          </text>
        </g>
      )}
    </svg>
  );
};
