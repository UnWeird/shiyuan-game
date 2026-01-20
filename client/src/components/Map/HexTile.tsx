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
  highlightSteps?: number; // 步数信息（用于不同颜色高亮）
  isPlayer1Zone?: boolean;
  isPlayer2Zone?: boolean;
}

export const HexTile: React.FC<HexTileProps> = React.memo(({
  hex,
  size,
  onClick,
  isBase = false,
  isSelected = false,
  isHighlighted = false,
  highlightSteps,
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
  let hexClass = 'hex-hover';

  if (isBase) {
    fillColor = isPlayer1Zone ? '#fef3c7' : '#dbeafe';
    strokeColor = isPlayer1Zone ? '#f59e0b' : '#3b82f6';
    strokeWidth = 3;
  } else if (isSelected) {
    fillColor = '#86efac';
    strokeColor = '#16a34a';
    strokeWidth = 2;
  } else if (isHighlighted) {
    // 统一使用橙色高亮
    fillColor = '#fcd34d';
    strokeColor = '#f59e0b';
    strokeWidth = 2;
    hexClass = 'hex-movable hex-hover';
  } else if (isPlayer1Zone) {
    fillColor = '#fef9c3';
  } else if (isPlayer2Zone) {
    fillColor = '#e0f2fe';
  }

  return (
    <>
      <path
        d={pathData}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className={hexClass}
        style={{
          cursor: onClick ? 'pointer' : 'default',
          touchAction: 'none', // 防止默认的触摸行为（如滚动）
        }}
      />

      {/* 如果是高亮格子且有步数信息，显示小点 */}
      {isHighlighted && highlightSteps && (
        <g>
          {Array.from({ length: highlightSteps }).map((_, index) => {
            // 根据步数排列小点
            const dotRadius = size * 0.08;
            const dotSpacing = size * 0.2;
            let dotX = center.x;
            let dotY = center.y;

            if (highlightSteps === 1) {
              // 1个点：中心
              dotX = center.x;
              dotY = center.y;
            } else if (highlightSteps === 2) {
              // 2个点：左右排列
              dotX = center.x + (index === 0 ? -dotSpacing/2 : dotSpacing/2);
              dotY = center.y;
            } else if (highlightSteps === 3) {
              // 3个点：品字形排列
              if (index === 0) {
                dotX = center.x;
                dotY = center.y - dotSpacing/2;
              } else if (index === 1) {
                dotX = center.x - dotSpacing/2;
                dotY = center.y + dotSpacing/2;
              } else {
                dotX = center.x + dotSpacing/2;
                dotY = center.y + dotSpacing/2;
              }
            }

            return (
              <circle
                key={index}
                cx={dotX}
                cy={dotY}
                r={dotRadius}
                fill="#f59e0b"
                stroke="#92400e"
                strokeWidth={1}
              />
            );
          })}
        </g>
      )}
    </>
  );
});
