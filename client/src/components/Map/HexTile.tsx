import React from 'react';
import { HexCoord } from '../../types';
import { hexToPixel, hexCorners } from '../../utils/hexUtils';

interface HexTileProps {
  hex: HexCoord;
  size: number;
  onClick?: (hex: HexCoord) => void;
  isBase?: boolean;
  isSelected?: boolean;
  isHighlighted?: boolean;
  isPlayer1Zone?: boolean;
  isPlayer2Zone?: boolean;
}

export const HexTile: React.FC<HexTileProps> = ({
  hex,
  size,
  onClick,
  isBase = false,
  isSelected = false,
  isHighlighted = false,
  isPlayer1Zone = false,
  isPlayer2Zone = false,
}) => {
  const center = hexToPixel(hex, size);
  const corners = hexCorners(center, size);
  const pathData = corners.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x},${c.y}`).join(' ') + ' Z';

  let fillColor = '#f5f5f5';
  let strokeColor = '#d0d0d0';
  let strokeWidth = 1;

  if (isBase) {
    fillColor = isPlayer1Zone ? '#fef3c7' : '#dbeafe';
    strokeColor = isPlayer1Zone ? '#f59e0b' : '#3b82f6';
    strokeWidth = 3;
  } else if (isSelected) {
    fillColor = '#86efac';
    strokeColor = '#16a34a';
    strokeWidth = 2;
  } else if (isHighlighted) {
    fillColor = '#fcd34d';
    strokeColor = '#f59e0b';
    strokeWidth = 2;
  } else if (isPlayer1Zone) {
    fillColor = '#fef9c3';
  } else if (isPlayer2Zone) {
    fillColor = '#e0f2fe';
  }

  return (
    <path
      d={pathData}
      fill={fillColor}
      stroke={strokeColor}
      strokeWidth={strokeWidth}
      onClick={() => onClick?.(hex)}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      className="transition-all duration-200 hover:opacity-80"
    />
  );
};
