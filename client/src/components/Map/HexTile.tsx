import React, { useRef, useCallback } from 'react';
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

  // 处理触摸事件（移动端兜底）
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!onClick) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }, [onClick]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!onClick || !touchStartRef.current) return;

    const touch = e.changedTouches[0];
    const deltaX = Math.abs(touch.clientX - touchStartRef.current.x);
    const deltaY = Math.abs(touch.clientY - touchStartRef.current.y);

    // 只有在没有明显滑动的情况下才触发点击（防止误触）
    if (deltaX < 10 && deltaY < 10) {
      e.preventDefault(); // 防止触发 click 事件导致双重触发
      onClick(hex);
    }

    touchStartRef.current = null;
  }, [onClick, hex]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!onClick) return;
    // 只在非触摸设备上处理点击
    if (e.detail === 0) return; // 如果是触摸事件触发的 click，忽略
    onClick(hex);
  }, [onClick, hex]);

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
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        touchAction: 'none', // 防止默认的触摸行为（如滚动）
      }}
      className="transition-all duration-200 hover:opacity-80"
    />
  );
};
